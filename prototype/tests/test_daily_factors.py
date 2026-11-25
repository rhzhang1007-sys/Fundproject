import json,math,sys,tempfile,unittest
from pathlib import Path
from datetime import date,timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from compute_daily_factors import structure,portfolio_risk,expected_shortfall,historical_path,aligned_returns
from collect_nav_snapshot import parse_row
from sync_nav_observations import sync
from build_global_foundation import write,shard

class FactorTests(unittest.TestCase):
 def test_equal_weights_hhi_and_observation_boundary(self):
  h=[dict(code=str(i),weightPercent=2.5) for i in range(20)];f=dict(periods=[dict(asOf='2026-06-30',holdings=h,complete=False)])
  s=structure([f],[1]);self.assertAlmostEqual(s['effective'],20);self.assertAlmostEqual(s['multiple'],1);self.assertEqual(s['coverage'],.5)
  self.assertFalse(structure([dict(periods=[dict(asOf='2026-06-30',holdings=h[:10])])],[1])['ready'])
  h[1]['code']=h[0]['code'];self.assertFalse(structure([f],[1])['ready'])
 def test_different_period_and_missing_weight_do_not_compute(self):
  def fund(day):return dict(periods=[dict(asOf=day,holdings=[dict(code=str(i),weightPercent=3) for i in range(20)])])
  self.assertFalse(structure([fund('2026-06-30'),fund('2026-09-30')],[.5,.5])['ready'])
  f=fund('2026-06-30');f['periods'][0]['holdings'][0]['weightPercent']=None;self.assertFalse(structure([f],[1])['ready'])
 def test_sample_covariance_risk_sum_and_negative_contribution(self):
  rows=[[.01 if i%2 else -.01,-.005 if i%2 else .005] for i in range(200)]
  r=portfolio_risk(rows,[.8,.2]);self.assertTrue(r['ready']);self.assertAlmostEqual(sum(r['riskShares']),1);self.assertLess(r['riskShares'][1],0);self.assertAlmostEqual(sum(r['deviations']),0);self.assertAlmostEqual(r['covariance'][0][0],.0001*200/199)
  self.assertFalse(portfolio_risk(rows[:199],[.8,.2])['ready']);self.assertFalse(portfolio_risk([[0,0]]*200,[.5,.5])['ready'])
 def test_es_uses_fractional_probability_mass(self):
  self.assertAlmostEqual(expected_shortfall([10,8]+[0]*28),(10+.5*8)/1.5)
 def test_path_is_buy_and_hold_and_recovery_is_from_trough(self):
  rows=[dict(**{'from':'2025-01-01'},date='2025-01-02',values=[-.5,0]),dict(**{'from':'2025-01-02'},date='2025-01-05',values=[1,0])]
  r=historical_path(rows,[.5,.5]);self.assertEqual(r['maxDrawdown'],.25);self.assertEqual(r['recoveryDays'],3);self.assertAlmostEqual(r['totalReturn'],0)
  rows[1]['from']='2025-01-03';self.assertFalse(historical_path(rows,[.5,.5])['ready'])
 def test_unadjusted_nav_and_future_points_never_enter_verified_returns(self):
  self.assertEqual(aligned_returns(dict(verified=False,basis='unit-nav'),[], '2026-11-24')[1],'verified-total-return-required')
  s=dict(verified=True,basis='nav-total-return',currency='CNY',points=[dict(date='2026-11-23',value=1),dict(date='2026-11-24',value=2),dict(date='2026-11-25',value=100)])
  rows,why=aligned_returns(s,['2026-11-23','2026-11-24','2026-11-25'],'2026-11-24');self.assertIsNone(why);self.assertEqual(len(rows),1);self.assertEqual(rows[0]['values'],[1])
 def test_nav_invalid_date_and_snapshot_merge_preserves_newer(self):
  raw=['000001','基金','','股票型','','0']+['']*9+['2026-02-30','1','1']+['']*6
  self.assertIsNone(parse_row(','.join(raw)))
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);d=root/'prototype/dist/data';write(d/'v10/objects.json',dict(objects=[dict(kind='fund',code='000001')]))
   write(d/'v11/observations/01.json',dict(schemaVersion=1,funds={'000001':dict(snapshot=dict(date='2026-11-24',nav=2))}))
   write(d/'v12/nav/latest.json',dict(asOf='2026-11-25',funds=[dict(code='000001',date='2026-11-23',nav=1)]));sync(root)
   self.assertEqual(json.loads((d/'v11/observations/01.json').read_text())['funds']['000001']['snapshot']['nav'],2)
if __name__=='__main__':unittest.main()
