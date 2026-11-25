"""Regression for cross-fund leakage; pure records only, never run WB collectors."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build_holdings_shards import shard_records,shard_key
class HoldingsShardTest(unittest.TestCase):
    def test_each_fund_keeps_own_periods_instead_of_last_source_record(self):
        records=[{'code':'516160','status':'ok','periods':[{'asOf':'2026-06-30','rows':[{'code':'300750','weight':9.42}]}]},
                 {'code':'515700','status':'ok','periods':[{'asOf':'2026-06-30','rows':[{'code':'002594','weight':8.44}]}]}]
        _,groups=shard_records(records)
        self.assertEqual(groups['60']['516160']['periods'][0]['rows'][0]['code'],'300750')
        self.assertEqual(groups['00']['515700']['periods'][0]['rows'][0]['code'],'002594')
        self.assertEqual(groups['60']['516160']['fundCode'],'516160')
    def test_letters_are_not_stripped_from_identity(self):
        self.assertEqual(shard_key('37001B'),'37')
