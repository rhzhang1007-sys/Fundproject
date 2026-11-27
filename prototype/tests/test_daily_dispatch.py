import unittest,tempfile,json,sys
from pathlib import Path
from datetime import datetime,timedelta,timezone
from zoneinfo import ZoneInfo
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from daily_dispatch import decision,wake
TZ=ZoneInfo('Asia/Shanghai')
class Wake(unittest.TestCase):
 def setUp(self):self.now=datetime(2026,11,27,11,tzinfo=TZ);self.settings={'maxAttemptsPerDay':4,'retryMinutes':45}
 def test_due_times_and_previous_day_do_not_suppress_today(self):
  self.assertFalse(decision('nav',{},[],self.settings,self.now.replace(hour=5,minute=9))['dispatch'])
  self.assertTrue(decision('nav',{'executionDay':'2026-11-26','executed':True},[],self.settings,self.now)['dispatch'])
  self.assertFalse(decision('news',{},[],self.settings,self.now.replace(hour=5,minute=29))['dispatch'])
 def test_successful_today_skips_but_partial_may_retry(self):
  m={'executionDay':'2026-11-27','executed':True,'retryNeeded':False}
  self.assertFalse(decision('nav',m,[],self.settings,self.now)['dispatch']);m['retryNeeded']=True
  self.assertTrue(decision('nav',m,[],self.settings,self.now)['dispatch'])
 def test_incomplete_legacy_marker_still_retries_and_validation_push_does_not_use_collection_cap(self):
  m={'executionDay':'2026-11-27','executed':True,'retryNeeded':False,'sourceCoverageStatus':'incomplete'}
  self.assertTrue(decision('nav',m,[],self.settings,self.now)['dispatch'])
  runs=[{'event':'push','status':'in_progress','created_at':'2026-11-27T02:00:00Z'}]*5
  self.assertTrue(decision('news',{},runs,self.settings,self.now)['dispatch'])
  self.assertFalse(decision('nav',{},runs,self.settings,self.now)['dispatch'])
 def test_queued_or_active_work_is_not_duplicated(self):
  for status in ['queued','in_progress','waiting','pending','requested']:
   self.assertFalse(decision('news',{},[{'status':status}],self.settings,self.now)['dispatch'])
 def test_partial_retries_are_spread_over_the_morning_instead_of_exhausted_before_late_nav_arrives(self):
  marker={'executionDay':'2026-11-27','executed':True,'retryNeeded':True,'attemptsToday':1}
  self.assertEqual(decision('nav',marker,[],self.settings,self.now.replace(hour=6,minute=30))['reason'],'awaiting-next-retry-window')
  self.assertTrue(decision('nav',marker,[],self.settings,self.now.replace(hour=7,minute=12))['dispatch'])
  marker['attemptsToday']=2
  self.assertFalse(decision('nav',marker,[],self.settings,self.now.replace(hour=8,minute=30))['dispatch'])
 def test_daily_cap_and_retry_backoff(self):
  run={'status':'completed','run_started_at':'2026-11-27T02:00:00Z','updated_at':'2026-11-27T02:30:00Z'}
  self.assertFalse(decision('news',{},[run],self.settings,self.now)['dispatch'])
  self.assertTrue(decision('news',{},[run],self.settings,self.now.replace(hour=12))['dispatch'])
  self.assertFalse(decision('news',{},[run]*4,self.settings,self.now.replace(hour=12))['dispatch'])
 def test_china_day_boundary_counts_utc_previous_date_as_today(self):
  r={'status':'completed','run_started_at':'2026-11-26T23:00:00Z','updated_at':'2026-11-26T23:01:00Z'}
  self.assertEqual(decision('nav',{},[r],self.settings,self.now)['attemptsToday'],1)
 def test_disabled_never_requests_network(self):
  self.assertEqual(wake('.',{'enabled':False},lambda *a: self.fail('network'))[0]['reason'],'disabled')
 def test_wake_uses_only_fixed_source_workflows_and_preserves_other_jobs_on_failure(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);p=root/'prototype/dist/data/v14/runtime';p.mkdir(parents=True);(p/'nav.json').write_text(json.dumps({'executionDay':'2026-11-27','executed':True}))
   calls=[]
   def request(route,body=None):
    calls.append((route,body))
    if 'daily-index' in route:raise OSError('service unavailable')
    return {'workflow_runs':[]}
   v=wake(root,{'enabled':True,'dailyDispatch':{'enabled':True}},request,self.now)
   self.assertEqual(v[0]['reason'],'source-already-executed-today');self.assertEqual(v[1]['reason'],'daily-wakeup-failed');self.assertTrue(v[2]['dispatch'])
   posts=[x for x in calls if x[1] is not None];self.assertEqual(posts,[('/actions/workflows/daily-public-data.yml/dispatches',{'ref':'main'})])
if __name__=='__main__':unittest.main()
