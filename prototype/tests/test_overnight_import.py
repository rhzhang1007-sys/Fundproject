import json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from import_overnight_data import FrozenInputs,period_record

class ImportContracts(unittest.TestCase):
 def test_repeated_security_values_remain_unknown(self):
  p=period_record('000001',{'asOf':'2026-06-30','rows':[{'code':'600001','name':'A','weight':1},{'code':'600001','name':'A','weight':2}]},None)
  self.assertFalse(p['complete']);self.assertEqual(p['holdings'][0]['weightPercent'],None);self.assertEqual(p['holdings'][0]['sourceWeightVariants'],[1,2])
 def test_a_source_file_modified_after_read_is_not_published(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'data.json';p.write_text('{}');f=FrozenInputs(folder);f.read('data.json');p.write_text('{"changed":true}')
   with self.assertRaises(ValueError):f.confirm()
 def test_bad_source_weights_are_not_cast_to_zero(self):
  with self.assertRaises(ValueError):period_record('000001',{'asOf':'2026-06-30','rows':[{'code':'600001','name':'A','weight':None}]},None)
