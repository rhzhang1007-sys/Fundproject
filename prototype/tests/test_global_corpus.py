import gzip,hashlib,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import github_corpus_cache as c
from build_global_foundation import write

class CorpusTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.pointer=self.root/'prototype/dist/data/v10/corpus-pointer.json'
 def test_checkpoint_upload_stays_private_and_only_then_advances_pointer(self):
  write(self.pointer,dict(assetId=2,releaseId=7));write(self.root/'prototype/.public-corpus/activity/funds/01.json',{'objects':{}});uploads={};removed=[]
  def request(url,token,method='GET',body=None,binary=False):
   if url.endswith('/releases/7'):return dict(id=7,draft=True,tag_name=c.TAG)
   if 'uploads.github.com' in url:
    uploads[3]=body;return json.dumps(dict(id=3,size=len(body),digest='sha256:'+hashlib.sha256(body).hexdigest())).encode()
   if url.endswith('/releases/assets/3'):return uploads[3]
   if url.endswith('/assets?per_page=100'):return [dict(id=i,name='forum-corpus-'+str(i)) for i in [1,2,3]]
   if method=='DELETE':removed.append(int(url.rsplit('/',1)[1]));return None
   raise AssertionError(url)
  with patch.object(c,'request',request):result=c.sync('push',self.root,token='test-only',repo='owner/repo')
  self.assertEqual(result['status'],'saved-and-verified');self.assertEqual(json.loads(self.pointer.read_text())['assetId'],3);self.assertEqual(removed,[1]);self.assertNotIn('test-only',self.pointer.read_text())
 def test_bad_upload_verification_preserves_old_authoritative_pointer(self):
  write(self.pointer,dict(assetId=2,releaseId=7));before=self.pointer.read_bytes()
  def request(url,token,method='GET',body=None,binary=False):
   if url.endswith('/releases/7'):return dict(id=7,draft=True)
   if 'uploads.github.com' in url:return json.dumps(dict(id=3,size=len(body))).encode()
   if url.endswith('/releases/assets/3'):return b'corrupt'
   raise AssertionError('No deletion before verification')
  with patch.object(c,'request',request):
   with self.assertRaises(ValueError):c.sync('push',self.root,token='test-only',repo='owner/repo')
  self.assertEqual(self.pointer.read_bytes(),before)
 def test_restore_rejects_traversal_before_writing_any_file(self):
  blob=gzip.compress(json.dumps(dict(schemaVersion=1,files={'../../escape.json':{}})).encode());write(self.pointer,dict(assetId=3,sha256=hashlib.sha256(blob).hexdigest()))
  with patch.object(c,'request',return_value=blob):
   with self.assertRaises(ValueError):c.sync('pull',self.root,token='test-only',repo='owner/repo')
  self.assertFalse((self.root/'prototype/escape.json').exists())
 def test_published_release_is_never_used_for_private_material(self):
  write(self.pointer,dict(assetId=2,releaseId=7))
  with patch.object(c,'request',return_value={'id':7,'draft':False}):
   with self.assertRaises(ValueError):c.sync('push',self.root,token='test-only',repo='owner/repo')
 def test_asset_upload_requests_json_response_and_download_requests_binary(self):
  with patch.object(c,'build_opener') as factory:
   factory.return_value.open.return_value.__enter__.return_value.read.return_value=b'{}'
   c.request('https://uploads.github.com/repos/owner/repo/releases/7/assets?name=test.gz','test-only','POST',b'bytes',binary=True)
   req=factory.return_value.open.call_args.args[0]
   self.assertEqual(req.get_header('Accept'),'application/vnd.github+json')
   self.assertEqual(req.get_header('Content-type'),'application/gzip')
   c.request('https://api.github.com/repos/owner/repo/releases/assets/3','test-only',binary=True)
   self.assertEqual(factory.return_value.open.call_args.args[0].get_header('Accept'),'application/octet-stream')

if __name__=='__main__':unittest.main()
