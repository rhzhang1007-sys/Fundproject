"""Regression coverage for the WorkBuddy pipeline; all sources/models are fixtures."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from datetime import date
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[1]/'scripts/refresh_public_data.py'
spec=importlib.util.spec_from_file_location('updates_review',SCRIPT)
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)

def post(pid='123',day='2026-11-23',**kw):
    return dict(post_id=pid,post_title='宁德时代订单讨论',post_publish_time=day+' 12:00:00',post_click_count=10,post_comment_count=0,**kw)

def row(pid='123'):
    return dict(id=pid,objectId='stock300750',title='宁德时代订单100亿元',content='网友提出观点',comments=[{'text':'同比10%','replyTo':''}],url='https://example.com/'+pid)

class Regressions(unittest.TestCase):
    def test_empty_day_is_valid_not_latest_page_fallback(self):
        self.assertEqual(u.forum_day(lambda url:json.dumps({'re':[]}), '300750','2026-11-23'),[])
    def test_old_pinned_post_does_not_stop_paging(self):
        pages=iter([{'re':[post('1','2020-01-01'),post('2','2026-11-24')]},{'re':[post('3')]},{'re':[]}])
        rows=u.forum_day(lambda url:json.dumps(next(pages)),'300750','2026-11-23',observed='2026-11-24')
        self.assertEqual([r['id'] for r in rows],['3']);self.assertEqual(rows[0]['observedAt'],'2026-11-24')
    def test_post_limit_does_not_publish_partial_as_complete(self):
        with self.assertRaises(u.IncompleteSource):
            u.forum_day(lambda _:json.dumps({'re':[post('1'),post('2')]}),'300750','2026-11-23',1)
    def test_repeated_page_and_schema_error_rejected(self):
        with self.assertRaises(u.IncompleteSource):u.forum_day(lambda _:json.dumps({'re':[post()]}),'300750','2026-11-23')
        with self.assertRaises(ValueError):u.forum_day(lambda _:'{"error":"blocked"}','300750','2026-11-23')
    def test_body_stops_at_matching_container_and_json_handles_braces(self):
        page='<div id="zwconbody"><p>正文100元</p><div>末句</div></div><div>不应混入</div><script>var reply_list={"re":[{"reply_text":"含};符号","reply_publish_time":"2026-11-23"}]};</script>'
        r=u.detail_record(page,5)
        self.assertEqual(r['content'],'正文100元 末句');self.assertEqual(r['comments'][0]['text'],'含};符号')
        self.assertEqual(r['coverage']['comments'],'partial');self.assertEqual(r['coverage']['reportedComments'],5)
    def test_details_use_injected_fetcher_and_refusal_propagates(self):
        r=row();r['commentCount']=0
        with patch.object(u,'urlopen',side_effect=AssertionError('No direct network')):
            u.fetch_details('300750',[r],fetch=lambda _:'<div id="zwconbody">原文</div>')
        self.assertEqual(r['content'],'原文')
        with self.assertRaises(u.SourceRefused):u.fetch_details('300750',[row()],fetch=lambda _:(_ for _ in ()).throw(u.SourceRefused('403')))
    def test_threshold_is_strictly_more_than_five(self):
        with patch.object(u,'llm_json',side_effect=AssertionError('threshold')):
            self.assertEqual(u.cluster_forum('名','2026-11-23',[row(str(i)) for i in range(5)])[1],'too-few-posts')
    def test_prompt_contains_real_ids_comments_and_all_posts(self):
        rows=[row(str(i+100)) for i in range(41)]
        def reply(system,user):
            self.assertIn('140',user);self.assertIn('同比10%',user)
            return {'claims':[{'text':'订单100亿元','postIds':['140'],'kind':'观点'}]}
        with patch.object(u,'llm_config',return_value=('https://example.com','secret','model')),patch.object(u,'llm_json',side_effect=reply):
            claims,why=u.cluster_forum('名','2026-11-23',rows,{})
        self.assertEqual(why,'ok');self.assertEqual(claims[0]['postIds'],['140'])
    def test_bad_citation_drops_whole_claim_and_number_substrings_fail(self):
        for text,ids in [('订单10亿元',['123']),('订单100亿元',['123','invented'])]:
            self.assertIsNone(u.validate_claims({'claims':[dict(text=text,postIds=ids,kind='观点')]},[row()]))
        self.assertIsNone(u.validate_claims({'claims':{}},[row()]))
    def test_content_comment_model_changes_invalidate_cache(self):
        rows=[row()];a=u.cache_key('stock300750','2026-11-23',rows)
        rows[0]['comments'][0]['text']='改过的评论'
        self.assertNotEqual(a,u.cache_key('stock300750','2026-11-23',rows))
    def test_budget_persists_across_reruns_before_any_request(self):
        with tempfile.TemporaryDirectory() as temp,patch.dict(os.environ,{'LLM_PRICE_IN':'1','LLM_PRICE_OUT':'2','LLM_DAILY_BUDGET':'0.001'}):
            p=Path(temp)/'ledger.json';u.init_llm(p,'2026-11-24')
            with patch.object(u,'urlopen',side_effect=AssertionError('Must stop before calling')):
                self.assertIsNone(u._post_llm('https://example.com','key','model',[{'content':'你好'}],700))
            self.assertTrue(u.LLM_STATE['stoppedByBudget']);u.LLM_STATE['costCNY']=0.0009;u.persist_usage()
            u.init_llm(p,'2026-11-24');self.assertEqual(u.LLM_STATE['costCNY'],0.0009)
            u.init_llm(p,'2026-11-25');self.assertEqual(u.LLM_STATE['costCNY'],0)
    def test_missing_prices_never_assume_cost_or_make_call(self):
        with tempfile.TemporaryDirectory() as temp,patch.dict(os.environ,{'LLM_PRICE_IN':'','LLM_PRICE_OUT':''}):
            u.init_llm(Path(temp)/'l.json','2026-11-24')
            with patch.object(u,'urlopen',side_effect=AssertionError('No price')):
                self.assertIsNone(u._post_llm('https://example.com','key','model',[],700))
    def test_failed_model_request_reservation_survives_restart(self):
        with tempfile.TemporaryDirectory() as temp,patch.dict(os.environ,{'LLM_PRICE_IN':'1','LLM_PRICE_OUT':'2'}):
            p=Path(temp)/'l.json';u.init_llm(p,'2026-11-24')
            with patch.object(u,'urlopen',side_effect=OSError('timeout')):u._post_llm('https://example.com','key','model',[],700)
            reserved=u.LLM_STATE['reservedCNY'];self.assertGreater(reserved,0)
            u.init_llm(p,'2026-11-24');self.assertEqual(u.LLM_STATE['reservedCNY'],reserved)
    def test_metrics_have_publication_day_and_actual_counts_no_word_sentiment(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);pages=iter([{'re':[post()]},{'re':[]}])
            cfg={'enabled':True,'objects':[{'kind':'stock','code':'300750','name':'宁德时代'}],'sources':{'forumLists':True}}
            with patch.object(u,'Fetcher',return_value=lambda _:json.dumps(next(pages))):u.run(root,cfg,True,as_of=date(2026,11,24))
            f=json.loads((root/'prototype/dist/data/v08/forum.json').read_text());m=f['metrics'][0]
            self.assertEqual(m['date'],'2026-11-23');self.assertEqual(m['readCount'],10);self.assertEqual(m['commentCount'],0)
            self.assertNotIn('titlePositiveRatio',m)
    def test_entity_longest_match_and_bare_number_does_not_tag(self):
        es=[dict(code='600000',name='中国平安',kind='stock'),dict(code='000001',name='平安银行',kind='stock')]
        self.assertEqual([x['code'] for x in u.match_entities('平安银行公告',es)],['000001'])
        self.assertEqual(u.match_entities('数量600000股',es),[])
    def test_global_refusal_does_not_become_single_news_error_or_replace_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);p=root/'prototype/dist/data/v07/events.json';p.parent.mkdir(parents=True);p.write_text('{"events":[]}')
            cfg={'enabled':True,'objects':[{'kind':'stock','code':'300750','name':'宁德时代'}],'sources':{'news':True}}
            with patch.object(u,'Fetcher',return_value=lambda _:(_ for _ in ()).throw(u.SourceRefused('429'))):
                with self.assertRaises(u.SourceRefused):u.run(root,cfg,True,as_of=date(2026,11,24))
            self.assertEqual(p.read_text(),'{"events":[]}')

    def test_tracking_parameters_are_removed_but_article_identity_is_retained(self):
        self.assertEqual(u.canonical_url('https://example.com/read?id=1&utm_source=x#p2'),'https://example.com/read?id=1')
        self.assertNotEqual(u.canonical_url('https://example.com/read?id=1'),u.canonical_url('https://example.com/read?id=2'))
        a=dict(id='a',entityCode='300750',title='标题一',date='2026-11-23',url='https://example.com/read?id=1&utm_source=x')
        b=dict(id='b',entityCode='002594',title='标题一的转载',date='2026-11-23',url='https://example.com/read?id=1')
        active,_=u.merge_events([a],[b],date(2026,11,24));self.assertEqual(len(active),1)
        self.assertEqual(active[0]['entityCodes'],['002594','300750'])
    def test_last_activity_boundary_handles_publish_time_out_of_order(self):
        rows=[post('1','2026-11-24'),post('2','2026-11-23'),post('3','2026-11-23'),post('4','2026-11-22')]
        for r,at in zip(rows,['2026-11-24 12:00:00','2026-11-24 10:00:00','2026-11-23 12:00:00','2026-11-22 12:00:00']):r['post_last_time']=at
        result=u.forum_day(lambda _:json.dumps({'rc':1,'re':rows}),'300750','2026-11-23')
        self.assertEqual([r['id'] for r in result],['2','3']);self.assertEqual(result.coverage,'last-activity-boundary')
