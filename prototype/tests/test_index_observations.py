import sys,math,unittest
from datetime import date,timedelta
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build_index_metrics import returns,max_drawdown,summarize
class IndexObservationTests(unittest.TestCase):
 def points(self,n):return [[(date(2024,1,1)+timedelta(days=i)).isoformat(),100*(1.01**i)] for i in range(n)]
 def test_short_window_is_not_one_year_and_252_returns_need_253_levels(self):
  self.assertIsNone(summarize(self.points(60))['return1y']);self.assertIsNone(summarize(self.points(252))['return252Obs']);self.assertAlmostEqual(summarize(self.points(253))['return252Obs'],1.01**252-1)
 def test_downside_uses_all_observations_and_large_moves_are_not_dropped(self):
  pts=self.points(60);pts[-1][1]*=.5;s=summarize(pts);rs=returns(pts)
  self.assertAlmostEqual(s['downsideVol'],math.sqrt(sum(min(r,0)**2 for r in rs)/len(rs)*252));self.assertTrue(s['jumpReviewRequired']);self.assertFalse(s['eligibleForFundRisk'])
 def test_invalid_date_duplicate_and_nonfinite_price_are_rejected(self):
  for pts in [[['2026-02-30',1]],[['2026-01-01',1],['2026-01-01',2]],[['2026-01-01',float('nan')]]]:
   with self.assertRaises(ValueError):returns(pts)
 def test_recovery_starts_at_trough_and_monotonic_is_zero_days(self):
  x=max_drawdown([['2026-01-01',10],['2026-01-02',5],['2026-01-06',10]]);self.assertEqual(x['recoverDays'],4);self.assertEqual(x['drawdown'],.5)
  self.assertEqual(max_drawdown(self.points(60))['recoverDays'],0)
if __name__=='__main__':unittest.main()
