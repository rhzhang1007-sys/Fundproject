import unittest,json,tempfile,sys,time
from pathlib import Path
from datetime import datetime,timedelta,timezone
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from forum_quality import assess,audit
from forum_watchdog import decision
from forum_repair import repair_queue
from build_global_foundation import write
class Quality(unittest.TestCase):
 def test_no_posts_is_unknown_until_source_list_boundary(self):
  self.assertFalse(assess('stock1','2026-11-25',{},{} )['complete'])
  self.assertEqual(assess('stock1','2026-11-25',{'coveredFrom':'2026-11-25','throughDay':'2026-11-25'}, {})['status'],'no-posts-confirmed')
 def test_null_coverage_and_unfetched_comments_are_incomplete(self):
  r={'id':'1','date':'2026-11-25','coverage':None,'comments':[]};task={'coveredFrom':'2026-11-25','throughDay':'2026-11-25'}
  self.assertEqual(assess('stock1','2026-11-25',task,{'records':[r]})['status'],'material-pending')
  r.update(content='正文',coverage={'body':'complete','comments':'unknown'})
  self.assertFalse(assess('stock1','2026-11-25',task,{'records':[r]})['complete'])
 def test_audit_queues_failed_samples_and_preserves_old_retry_dates(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);d=root/'prototype/dist/data';now=datetime.now(timezone.utc).astimezone();target=(now.date()-timedelta(days=1)).isoformat();older=(now.date()-timedelta(days=2)).isoformat()
   write(d/'v10/objects.json',{'objects':[{'id':'fund1','kind':'fund'},{'id':'stock1','kind':'stock'}]});write(d/'v10/forum-state.json',{'objects':{},'updatedAt':now.isoformat(),'retryQueue':[{'objectId':'stock1','date':older,'stage':'list','attempts':1}]})
   report=audit(root);state=json.loads((d/'v10/forum-state.json').read_text());self.assertEqual(report['status'],'partial');self.assertEqual({x['objectId']for x in report['sample']},{'fund1','stock1'});self.assertIn(older,{x['date']for x in state['retryQueue']});self.assertGreaterEqual(len(state['retryQueue']),3)
 def test_watchdog_dispatches_overdue_only_and_does_not_duplicate_active_jobs(self):
  now=datetime(2026,11,26,10,tzinfo=timezone.utc)
  self.assertTrue(decision([{'status':'completed','updated_at':'2026-11-26T08:00:00Z','id':1}],now)['dispatch'])
  self.assertFalse(decision([{'status':'in_progress','created_at':'2026-11-26T08:00:00Z'}],now)['dispatch'])
  self.assertFalse(decision([{'status':'completed','updated_at':'2026-11-26T09:50:00Z'}],now)['dispatch'])
 def test_retries_are_bounded_backed_off_and_do_not_duplicate_full_body_snapshots(self):
  from zoneinfo import ZoneInfo
  day=(datetime.now(ZoneInfo('Asia/Shanghai')).date()-timedelta(days=1)).isoformat();obj={'id':'stock1','kind':'stock','code':'1'};forum={'records':[]};state={'objects':{},'retryQueue':[{'objectId':'stock1','date':day,'stage':'list','nextAttemptAt':'','attempts':0}]};calls=[]
  def collect(*args,**kwargs):calls.append(args);return {'sources':{'eastmoney':{'status':'window-complete'}},'records':[{'id':'p','objectId':'stock1','date':day,'content':'正文','comments':[],'coverage':{'body':'complete','comments':'complete'}}]}
  r=repair_queue(Path('.'),state,[obj],lambda o:forum,lambda:None,time.monotonic()+120,collector=collect);self.assertEqual(r['attempted'],1);self.assertEqual(forum['records'][0]['content'],'正文');self.assertNotIn('records',forum['repairSnapshots'][day]);self.assertEqual(state['objects']['stock1']['dayWindows'][day],'window-complete')
  repair_queue(Path('.'),state,[obj],lambda o:forum,lambda:None,time.monotonic()+120,collector=collect);self.assertEqual(len(calls),1)
if __name__=='__main__':unittest.main()
