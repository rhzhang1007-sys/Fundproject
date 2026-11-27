import unittest,tempfile,json,re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from prepare_v08_public_site import prepare,ROOT

class Pages(unittest.TestCase):
 def test_pages_package_preserves_all_analysis_and_holding_shards_while_moving_only_large_observations_to_versioned_reading(self):
  with tempfile.TemporaryDirectory() as tmp:
   dest=Path(tmp)/'site';revision='a'*40;prepare(ROOT,dest,profile='pages',revision=revision)
   report=json.loads((dest/'pages-data-index.json').read_text());self.assertLess(report['siteBytes'],950_000_000);self.assertFalse(report['sourceDataDeleted']);self.assertTrue(report['remoteFiles'])
   for rel in ['data/v10/objects.json','data/v11/relationships','data/v11/resources','data/v14/nav','data/v14/holdings','data/v16']:
    source=ROOT/'prototype/dist'/rel;target=dest/rel
    if source.is_file():self.assertEqual(source.read_bytes(),target.read_bytes())
    else:self.assertEqual({x.name for x in source.iterdir() if x.is_file()},{x.name for x in target.iterdir() if x.is_file()})
   source=ROOT/'prototype/dist';keys={x[-2:] for x in re.findall(r"code:'([0-9]{6})'",(source/'initial-holdings.mjs').read_text())}
   self.assertEqual({p.stem for p in (dest/'data/v11/observations').glob('*.json')},keys)
   for item in report['remoteFiles']:self.assertIn('/'+revision+'/prototype/dist/data/',item['url'])
   self.assertIn(revision,(dest/'deployment-config.mjs').read_text());self.assertFalse(list(dest.rglob('.env*')))
 def test_pages_requires_an_immutable_data_ref(self):
  with tempfile.TemporaryDirectory() as tmp:self.assertRaises(ValueError,prepare,ROOT,Path(tmp)/'site',profile='pages',revision='main')
if __name__=='__main__':unittest.main()
