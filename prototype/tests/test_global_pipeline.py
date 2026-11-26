import json,sys,time,tempfile,unittest
from pathlib import Path
from datetime import date
from urllib.parse import urlparse,parse_qs
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import global_forum as g
import news_llm_queue as n
from unittest.mock import patch
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import refresh_public_data as u
from public_comments import read_comments
from build_global_foundation import write

class GlobalTests(unittest.TestCase):
 def fixture(self):
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);root=Path(tmp.name);d=root/'prototype/dist/data'
  write(d/'v10/objects.json',{'objects':[dict(id='fund000001',kind='fund',code='000001',name='基金一'),dict(id='stock600000',kind='stock',code='600000',name='股票一'),dict(id='fund000002',kind='fund',code='000002',name='无详情基金')]})
  write(d/'v10/foundation-manifest.json',{'fundDetails':1});write(d/'v07/events.json',{'events':[]})
  cfg={'enabled':True,'forumDaily':{'enabled':True,'mode':'global-queue','listBatchSeconds':1,'pagesPerVisit':1,'detailObjectsPerBatch':0},'minPostsForClaims':5}
  return root,d,cfg
 def test_full_registry_does_not_require_static_objects(self):
  root,d,cfg=self.fixture();seen=[]
  def fetch(url):seen.append(parse_qs(urlparse(url).query)['code'][0]);return json.dumps({'rc':1,'re':[]})
  result=g.run(root,cfg,fetch,date(2026,11,24),time.monotonic()+120)
  self.assertEqual(set(seen),{'of000001','of000002','600000'});self.assertEqual(result['coverage']['pending'],0)
 def test_partial_pages_resume_without_zero_or_dropping_rows(self):
  root,d,cfg=self.fixture();pages=[]
  def fetch(url):
   q=parse_qs(urlparse(url).query);p=int(q['p'][0]);code=q['code'][0];pages.append((code,p))
   rows=[dict(post_id=1,post_title='公开帖子',post_publish_time='2026-11-23 10:00:00',post_click_count=3,post_comment_count=0)] if code=='of000001' and p==1 else []
   return json.dumps({'rc':1,'re':rows})
  one=g.run(root,cfg,fetch,date(2026,11,24),time.monotonic()+120);self.assertEqual(one['coverage']['pending'],1)
  state=json.loads((d/'v10/forum-state.json').read_text());self.assertEqual(state['objects']['fund000001']['scan']['page'],2);self.assertNotIn('throughDay',state['objects']['fund000001'])
  two=g.run(root,cfg,fetch,date(2026,11,24),time.monotonic()+120);self.assertEqual(two['coverage']['pending'],0);self.assertIn(('of000001',2),pages)
  data=json.loads((root/'prototype/.public-corpus/activity/funds/01.json').read_text());self.assertEqual(len(data['objects']['fund000001']['forum']['records']),1)
  public=json.loads((d/'v10/activity/funds/01.json').read_text());self.assertEqual(public['objects']['fund000001']['forum']['records'][0]['id'],'1');self.assertEqual(public['objects']['fund000001']['forum']['storedPostCount'],1)
 def test_legacy_null_coverage_remains_pending_without_crashing_publish(self):
  root,d,cfg=self.fixture();write(root/'prototype/.public-corpus/activity/funds/01.json',{'objects':{'fund000001':{'news':[],'forum':{'records':[{'id':'42','objectId':'fund000001','date':'2026-11-23','title':'已收录标题','coverage':None,'comments':[]}]}}}})
  result=g.run(root,cfg,lambda url:json.dumps({'rc':1,'re':[]}),date(2026,11,24),time.monotonic()+120)
  self.assertEqual(result['status'],'partial');self.assertEqual(result['coverage']['bodiesCompleteOnTarget'],0);self.assertEqual(result['coverage']['selectedPostsOnTarget'],1)
 def test_refusal_stops_every_object_and_retains_global_cooldown(self):
  root,d,cfg=self.fixture();calls=[]
  def denied(url):calls.append(url);raise u.SourceRefused('403')
  result=g.run(root,cfg,denied,date(2026,11,24),time.monotonic()+120);self.assertEqual(len(calls),1);self.assertEqual(result['coverage']['pending'],3)
  again=g.run(root,cfg,denied,date(2026,11,24));self.assertEqual(again['status'],'source-cooldown');self.assertEqual(len(calls),1)
 def test_rolling_retention_removes_only_retired_public_archives(self):
  root,d,cfg=self.fixture();write(d/'archive/2026-01.json',{'events':[]});write(d/'archive/forum-2026-01.json',{'records':[]});write(d/'archive/report.json',{'keep':True});cfg.update(retentionMode='rolling-30-days')
  u.run(root,cfg,as_of=date(2026,11,24));self.assertFalse((d/'archive/2026-01.json').exists());self.assertFalse((d/'archive/forum-2026-01.json').exists());self.assertTrue((d/'archive/report.json').exists())
 def test_react_article_body_is_read_without_evaluating_script(self):
  page='<script>var post_article='+json.dumps({'post_content':'<p>真实正文20亿元</p>'},ensure_ascii=False)+';</script>'
  result=u.detail_record(page,0);self.assertEqual(result['content'],'真实正文20亿元');self.assertEqual(result['coverage']['body'],'complete');self.assertEqual(result['coverage']['bodySource'],'embedded-post-article')
 def test_repeated_comment_page_stays_partial_and_keeps_text(self):
  row={'id':'1','commentCount':3,'comments':[],'coverage':{}};payload={'rc':1,'count':3,'reply_total_count':3,'re':[{'reply_id':11,'reply_text':'原文评论','reply_count':0,'child_replys':[]}]}
  read_comments(lambda url:json.dumps(payload),row,1);read_comments(lambda url:json.dumps(payload),row,1)
  self.assertEqual(len(row['comments']),1);self.assertEqual(row['coverage']['comments'],'partial');self.assertIn('Repeated',row['coverage']['commentError'])
 def test_top_and_child_comment_pagination_deduplicates_and_checks_total(self):
  row={'id':'1','commentCount':3,'comments':[],'coverage':{}}
  def fetch(url):
   if 'ArticleReplyDetail' in url:return json.dumps({'rc':1,'re':{'child_replys':[{'reply_id':12,'reply_text':'子评论一'},{'reply_id':13,'reply_text':'子评论二'}]}})
   return json.dumps({'rc':1,'count':1,'reply_total_count':3,'re':[{'reply_id':11,'reply_text':'一级评论','reply_count':2,'child_replys':[{'reply_id':12,'reply_text':'子评论一'}]}]})
  result=read_comments(fetch,row,3);self.assertTrue(result['complete']);self.assertEqual(len(row['comments']),3);self.assertEqual(row['coverage']['comments'],'complete');self.assertTrue(all('user_id' not in x for x in row['comments']))
 def test_same_code_different_role_events_do_not_merge(self):
  events=[dict(id=kind,entityCode='000001',title='同一标题',date='2026-11-23',url='https://example.com/'+kind,entities=[{'kind':kind,'code':'000001'}]) for kind in ['fund','stock']]
  self.assertEqual(len(u.merge_events([],events,date(2026,11,24))[0]),2)


 def test_news_model_points_cannot_borrow_other_article_numbers(self):
  events=[dict(id='a',title='原文增长5%',summary='增长5%'),dict(id='b',title='增长99%',summary='增长99%')]
  good={'items':[{'id':e['id'],'points':[{'text':e['summary'],'kind':'事实','sourceIds':[e['id']]}]} for e in events]}
  self.assertEqual(set(n.validate_items(good,events)),{'a','b'})
  good['items'][0]['points'][0]['text']='增长99%';self.assertIsNone(n.validate_items(good,events))
 def test_news_queue_skips_title_only_and_unattributed_old_summaries(self):
  root,d,cfg=self.fixture();today=datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
  write(d/'v07/events.json',{'events':[dict(id='a',title='标题',summary='',date=today,contentCoverage='title-only'),dict(id='b',title='摘录',summary='增长5%',date=today,contentCoverage='source-feed'),dict(id='c',title='旧样例',summary='旧说明',date=today)]});cfg['newsLLM']={'enabled':True}
  with patch.object(u,'llm_config',return_value=(None,None,None)):
   result=n.run(root,cfg)
  self.assertEqual(result['eligible'],1);self.assertEqual(result['pending'],1);self.assertEqual(result['status'],'no-model')
 def test_live_billing_midnight_loads_existing_new_day_budget(self):
  root,d,cfg=self.fixture();today=datetime.now(ZoneInfo('Asia/Shanghai')).date();yesterday=today-timedelta(days=1);folder=d/'v08/llm-usage'
  write(folder/(yesterday.isoformat()+'.json'),{'date':yesterday.isoformat(),'costCNY':2,'reservedCNY':0})
  write(folder/(today.isoformat()+'.json'),{'date':today.isoformat(),'costCNY':0,'reservedCNY':5})
  with patch.object(u,'_price',return_value=(1,1)),patch.object(u,'_budget',return_value=5),patch.object(u,'LLM_LIVE_BILLING',True),patch.object(u,'LLM_DEADLINE',None),patch.object(u,'urlopen',side_effect=AssertionError('must not call provider')):
   u.init_llm(folder/(yesterday.isoformat()+'.json'),yesterday.isoformat());u.MODEL_CIRCUIT_ERROR=None
   self.assertIsNone(u._post_llm('https://example.test','test','glm-5.3-flash',[],8192));self.assertEqual(u.LLM_STATE['date'],today.isoformat());self.assertTrue(u.LLM_STATE['stoppedByBudget'])
  self.assertEqual(json.loads((folder/(yesterday.isoformat()+'.json')).read_text())['costCNY'],2)


 def test_single_post_gets_body_without_claims_or_model(self):
  root,d,cfg=self.fixture();cfg.update(llmClaims=False,maxPostsPerObject=30);cfg['forumDaily'].update(pagesPerVisit=2,detailObjectsPerBatch=3,detailsPerVisit=30)
  def fetch(url):
   if '/news,' in url:return '<script>var post_article={"post_content":"<p>正文内容</p>"};</script>'
   q=parse_qs(urlparse(url).query);rows=[dict(post_id=42,post_title='独立帖子',post_publish_time='2026-11-23 10:00:00',post_click_count=1,post_comment_count=0)] if q['code']==['of000001'] and q['p']==['1'] else []
   return json.dumps({'rc':1,'re':rows})
  with patch.object(u,'cluster_forum',side_effect=AssertionError('No scheduled aggregation')),patch.object(n,'run',side_effect=AssertionError('No scheduled model')):
   result=g.run(root,cfg,fetch,date(2026,11,24),time.monotonic()+120)
  post=json.loads((d/'v12/posts/funds/000001.json').read_text())['records'][0]
  self.assertEqual(post['content'],'正文内容');self.assertEqual(post['coverage']['comments'],'complete');self.assertEqual(result['enrichedPosts'],1)
 def test_daily_cap_is_30_and_does_not_claim_complete_source_count(self):
  root,d,cfg=self.fixture();cfg.update(maxPostsPerObject=30);cfg['forumDaily']['pagesPerVisit']=2
  def fetch(url):
   q=parse_qs(urlparse(url).query);rows=[dict(post_id=i+1,post_title='帖子'+str(i),post_publish_time='2026-11-23 10:00:00',post_top_status=0) for i in range(50)] if q['code']==['of000001'] else []
   return json.dumps({'rc':1,'re':rows})
  g.run(root,cfg,fetch,date(2026,11,24),time.monotonic()+120)
  post=json.loads((d/'v10/activity/funds/01.json').read_text())['objects']['fund000001']['forum']
  self.assertEqual(len(post['records']),30);self.assertEqual(post['listCoverage']['status'],'daily-cap-reached');self.assertEqual(post['metrics'][0]['coverage'],'daily-cap')

if __name__=='__main__':unittest.main()
