import importlib.util
from pathlib import Path
import sys,json,tempfile,unittest
from datetime import date
from unittest.mock import patch
SCRIPTS=Path(__file__).resolve().parents[1]/'scripts'
if str(SCRIPTS) not in sys.path:sys.path.insert(0,str(SCRIPTS))
import public_news as n
import market_public as m
import daily_pipeline as d
import refresh_public_data as u

class NewsPipeline(unittest.TestCase):
    def index(self):return n.EntityIndex([dict(kind='stock',code='000001',name='平安银行',exchange='SZSE',matchKeywords=['平安银行','平安']),dict(kind='stock',code='601318',name='中国平安',exchange='SSE',matchKeywords=['中国平安','平安']),dict(kind='fund',code='000001',name='华夏成长混合'),dict(kind='fund',code='516160',name='新能源ETF南方')])
    def test_conflicts_are_candidates_not_labels_and_codes_have_roles(self):
        idx=self.index();tags,hints=idx.tag('平安发布消息；数量000001股')
        self.assertFalse(tags);tags,_=idx.tag('基金代码000001');self.assertEqual([(x['kind'],x['code']) for x in tags],[('fund','000001')])
        tags,_=idx.tag('股票代码000001');self.assertEqual(tags[0]['kind'],'stock')
    def test_long_names_multiple_mentions_and_multi_security_keep_roles(self):
        idx=self.index();tags,_=idx.tag('平安银行和中国平安公告')
        self.assertEqual({x['code'] for x in tags},{'000001','601318'})
    def test_fast_news_publisher_codes_do_not_include_hong_kong_or_sector_as_stock(self):
        payload=dict(code='1',data=dict(fastNewsList=[dict(code='2026112412345',title='新闻',summary='事项',showTime='2026-11-24 10:00:00',stockList=['0.000001','116.00001','90.BK0001'])],sortEnd='10'))
        es,dates,_=n.fast_page(payload,self.index());self.assertEqual(es[0]['entities'][0]['code'],'000001');self.assertEqual(dates,['2026-11-24'])
        payload['data']['fastNewsList'][0]['stockList']=['1.000001']
        unassigned=n.fast_page(payload,self.index())[0];self.assertEqual(unassigned[0]['sourceSecurityRefs'],['1.000001']);self.assertEqual(unassigned[0]['entities'][0]['kind'],'unassigned');self.assertFalse(any(t.get('kind')=='stock' for e in unassigned for t in e['entities'])) # Keep unresolved source material without tagging Shanghai index as Shenzhen stock.
    def test_index_number_matching_only_fund_directory_does_not_tag_that_fund(self):
        idx=n.EntityIndex([dict(kind='fund',code='000300',name='另一只场外基金')])
        payload=dict(code='1',data=dict(fastNewsList=[dict(code='2026112412345',title='沪深300指数',summary='指数情况',showTime='2026-11-24 10:00:00',stockList=['1.000300'])],sortEnd='10'))
        events,_,_=n.fast_page(payload,idx);self.assertFalse(any(t['kind']=='fund' for e in events for t in e['entities']));self.assertEqual(events[0]['sourceSecurityRefs'],['1.000300'])
    def test_business_errors_never_count_as_zero_news(self):
        with self.assertRaises(ValueError):n.fast_page({'code':0,'data':None},self.index())
    def test_cursor_is_forwarded_and_date_window_excludes_future(self):
        pages=iter([dict(code='1',data=dict(fastNewsList=[dict(code='1',title='平安银行公告',showTime='2026-11-25 08:00:00')],sortEnd='cursor1')),dict(code='1',data=dict(fastNewsList=[dict(code='2',title='平安银行公告',showTime='2026-11-23 08:00:00')],sortEnd='cursor2')),dict(code='1',data=dict(fastNewsList=[dict(code='3',title='平安银行公告',showTime='2026-11-20 08:00:00')],sortEnd='cursor3'))])
        urls=[]
        def fetch(url):urls.append(url);return json.dumps(next(pages))
        rows,status=n.collect_fast(fetch,self.index(),'2026-11-23','2026-11-24',5)
        self.assertEqual(len(rows),1);self.assertIn('sortEnd=cursor1',urls[1]);self.assertEqual(status['status'],'date-boundary')
    def test_partial_page_limit_is_explicit(self):
        data=dict(code='1',data=dict(fastNewsList=[dict(code='1',title='平安银行公告',showTime='2026-11-24 08:00:00')],sortEnd='a'))
        _,status=n.collect_fast(lambda _:json.dumps(data),self.index(),'2026-11-23','2026-11-24',1)
        self.assertEqual(status['status'],'partial-page-limit')
    def test_fund_announcements_explicit_identity_and_source_id_merge(self):
        payload=dict(ErrCode=0,Data=[dict(FUNDCODE='516160',TITLE='费率调整公告',PUBLISHDATEDesc='2026-11-24',ID='AN123')])
        rows,_=n.fund_page(payload,self.index());rows=n.prepare_events(rows)
        self.assertEqual(rows[0]['entities'][0]['kind'],'fund');self.assertTrue(any(t['id']=='product' for t in rows[0]['topics']))
        copy={**rows[0],'entityCode':'000001','entityCodes':['000001'],'entities':[{'kind':'fund','code':'000001','name':'华夏成长混合'}],'url':'https://fund.eastmoney.com/gonggao/000001,AN123.html'}
        active,_=u.merge_events(rows,[copy],date(2026,11,24));self.assertEqual(len(active),1)
        self.assertEqual(len(active[0]['entities']),2);self.assertIn('topics',active[0])
    def test_board_flow_unknowns_do_not_become_zero(self):
        rows,total=m.board_page(dict(rc=0,data=dict(total=1,diff=[dict(f12='BK1',f14='机器人',f124=1795505997,f62='-',f184='-')])), 'concept')
        self.assertEqual(total,1);self.assertIsNone(rows[0]['mainNetFlowCNY']);self.assertEqual(rows[0]['asOf'],'2026-11-24')
    def test_market_history_deduplicates_dates_without_inventing_percentile(self):
        a=dict(indexCode='930997',asOf='2026-11-23',peTotalShares=20,percentiles=None)
        merged=m.merge_valuations([a],[{**a,'peTotalShares':21}]);self.assertEqual(len(merged),1);self.assertIsNone(merged[0]['percentiles'])
        self.assertEqual(merged[0]['revisions'][0]['peTotalShares'],20)
        checked=m.merge_valuations(merged,[{**a,'peTotalShares':21}])
        self.assertEqual(len(checked[0]['revisions']),1)
    def test_offline_preflight_makes_no_network_calls(self):
        with tempfile.TemporaryDirectory() as t,patch.object(d,'CurlPublicFetcher',side_effect=AssertionError('offline')):
            report=d.run(Path(t),{'enabled':False});self.assertFalse(report['collectionEnabled']);self.assertFalse(report['sourceFilesReady'])
    def test_company_market_filters_and_empty_market_are_checked(self):
        with self.assertRaises(ValueError):n.company_page(dict(totalAnnouncement=1,announcements=[dict(pageColumn='SZCY')]),self.index(),'sh','2026-11-23','2026-11-24')
        events,items,total=n.company_page(dict(totalAnnouncement=0,announcements=None),self.index(),'bj','2026-11-23','2026-11-24')
        self.assertEqual((events,items,total),([],[],0))
    def test_source_unknown_issuer_is_retained_even_with_an_incidental_known_name(self):
        e=n._event('cninfo:1','平安银行合作公告','','2026-11-24','https://example.com','来源','公告',self.index(),[('stock','920999')])
        self.assertEqual({x['code'] for x in e['entities']},{'000001','920999'})
    def test_partial_feed_never_reports_complete_run(self):
        self.assertTrue(d.partial_coverage({'coverage':{'sh':{'status':'partial-page-limit'}}}))
        self.assertFalse(d.partial_coverage({'status':'date-boundary'}))
    def test_fund_announcement_fallback_keeps_explicit_fund_role_and_partial_scope(self):
        row=dict(secCode='516160',announcementId='1',announcementTitle='基金费率调整',announcementTime=1795449600000,adjunctUrl='finalpage/2026-11-24/1.PDF')
        def fetch(url,params=None):
            return json.dumps(dict(ErrCode=1,Data=None) if 'eastmoney' in url else dict(totalAnnouncement=1,announcements=[row],hasMore=False))
        events,check=n.collect_fund_announcements(fetch,self.index(),'2026-11-23','2026-11-24')
        self.assertEqual(events[0]['entities'][0]['kind'],'fund');self.assertEqual(check['status'],'partial-source-fallback')
    def test_all_forum_lists_are_saved_before_any_long_detail_request(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);base=root/'prototype/dist';(base/'data/v07').mkdir(parents=True);(base/'data/v09').mkdir();(base/'index.html').write_text('')
            (base/'data/v07/funds-l1.json').write_text('[]');(base/'data/v09/security-identities.json').write_text('{"stocks":[]}')
            calls=[]
            def run(*args,**kwargs):
                if kwargs.get('collect'):calls.append((args[1]['objects'][0]['code'],args[1].get('forumDetails')))
            cfg=dict(enabled=True,objects=[dict(kind='fund',code='516160',name='基金'),dict(kind='stock',code='000009',name='股票')],forumDaily={'enabled':True},forumDetails=True,newsSources={'fast-news':False,'fund-announcements':False,'company-announcements':False})
            with patch.object(u,'forum_day',side_effect=lambda *a,**k:u.ForumDayRows()),patch.object(u,'run',side_effect=run):d.run(root,cfg,True,date(2026,11,25),lambda _:None)
            self.assertEqual(calls,[('516160',False),('000009',False),('516160',True),('000009',True)])
    def test_one_failed_feed_preserves_prior_news_and_other_valid_updates(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);dest=root/'prototype/dist/data';(dest/'v07').mkdir(parents=True);(dest/'v09').mkdir()
            (root/'prototype/dist/index.html').write_text('test')
            (dest/'v07/funds-l1.json').write_text('[]')
            (dest/'v09/security-identities.json').write_text('{"stocks":[]}')
            old=dict(id='old',title='旧事件',date='2026-11-23',url='https://example.com/old',entityCode='601318')
            new=dict(id='new',title='新事件',date='2026-11-24',url='https://example.com/new',entityCode='601318')
            (dest/'v07/events.json').write_text(json.dumps({'events':[old]}))
            cfg=dict(enabled=True,forumDaily={'enabled':False},marketDaily={'enabled':False})
            with patch.object(d,'collect_fast',side_effect=ValueError('schema changed')),patch.object(d,'collect_fund_announcements',return_value=([new],{'status':'source-exhausted'})),patch.object(d,'collect_company_announcements',return_value=([],{'status':'source-exhausted'})):
                result=d.run(root,cfg,True,date(2026,11,25),lambda _:None)
            self.assertTrue(result['newsReady']);self.assertEqual(result['status'],'partial')
            saved=json.loads((dest/'v07/events.json').read_text())['events']
            self.assertEqual({e['title'] for e in saved},{'旧事件','新事件'})
    def test_model_id_is_not_numeric_evidence(self):
        rows=[dict(id='123',title='订单增加',content='尚未说明数量',comments=[])]
        self.assertIsNone(u.validate_claims({'claims':[dict(text='订单123份',postIds=['123'],kind='观点')]},rows))
    def test_all_long_post_and_comment_text_is_assigned_to_chunks(self):
        content='正文。'*10000;comment='评论！'*5000
        chunks=u.forum_chunks([dict(id='1',title='标题',objectId='stock000001',content=content,comments=[dict(text=comment)])])
        self.assertGreater(len(chunks),1)
        self.assertEqual(''.join(r['content'] for c in chunks for r in c),content)
        self.assertEqual(''.join(x['text'] for c in chunks for r in c for x in r['comments']),comment)
        self.assertTrue(all(sum(len(json.dumps(u.claim_material(r),ensure_ascii=False).encode()) for r in c)<=24000 for c in chunks))
