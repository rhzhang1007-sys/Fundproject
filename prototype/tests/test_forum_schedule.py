import unittest,sys
from pathlib import Path
from datetime import datetime,date,timezone
from zoneinfo import ZoneInfo
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from forum_schedule import collection_day,batch_allowed
from forum_continue import plan
class Schedule(unittest.TestCase):
 def test_daily_target_rolls_only_at_five_cst(self):
  self.assertEqual(collection_day(now=datetime(2026,11,26,4,59,tzinfo=ZoneInfo('Asia/Shanghai'))),date(2026,11,25))
  self.assertEqual(collection_day(now=datetime(2026,11,26,5,tzinfo=ZoneInfo('Asia/Shanghai'))),date(2026,11,26))
  self.assertEqual(collection_day(now=datetime(2026,11,25,21,tzinfo=timezone.utc)),date(2026,11,26))
 def test_cooldown_compares_instants_and_cap_resets_next_collection_day(self):
  day=date(2026,11,26);settings={'maxBatchesPerDay':72}
  self.assertFalse(batch_allowed({'cooldownUntil':'2026-11-26T15:00:00+08:00'},settings,day,'2026-11-26T06:30:00Z')[0])
  self.assertTrue(batch_allowed({'cooldownUntil':'2026-11-26T14:00:00+08:00'},settings,day,'2026-11-26T06:30:00Z')[0])
  self.assertFalse(batch_allowed({'batchDate':'2026-11-26','batchesStarted':72},settings,day,'2026-11-26T18:00:00+08:00')[0])
  self.assertTrue(batch_allowed({'batchDate':'2026-11-25','batchesStarted':72},settings,day,'2026-11-26T18:00:00+08:00')[0])
 def test_chain_requires_progress_and_does_not_duplicate_other_runs(self):
  c={'enabled':True,'forumDaily':{'enabled':True}};b={'completedWindows':5,'seconds':880};h={'status':'partial'};now=datetime(2026,11,26,8,tzinfo=ZoneInfo('Asia/Shanghai'))
  self.assertTrue(plan(c,{},b,h,[{'id':1,'status':'in_progress'}],current_id='1',now=now)['dispatch'])
  self.assertFalse(plan(c,{},b,h,[{'id':2,'status':'queued'}],current_id='1',now=now)['dispatch'])
  self.assertFalse(plan(c,{},b,{'status':'ready'},[],now=now)['dispatch'])
  self.assertFalse(plan(c,{},dict(seconds=890),h,[],now=now)['dispatch'])
  self.assertFalse(plan(c,{},dict(completedWindows=1,seconds=2),h,[],now=now)['dispatch'])
  self.assertFalse(plan(c,{'cooldownUntil':'2026-11-27T08:00:00+08:00'},b,h,[],now=now)['dispatch'])
if __name__=='__main__':unittest.main()
