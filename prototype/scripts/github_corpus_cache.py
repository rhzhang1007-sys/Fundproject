"""Private draft-release corpus checkpoints; no raw forum corpus in Git history.

GITHUB_TOKEN is used in Authorization only. No credentials or signed URLs are stored.
Public frontend JSON contains source citations/aggregations, while resumable material
is kept in at most two verified checkpoint assets. Input paths are strictly bounded.
"""
import argparse,gzip,hashlib,json,os,re,tempfile
from datetime import datetime,timezone
from pathlib import Path
from urllib.request import Request,build_opener,HTTPRedirectHandler
from urllib.error import HTTPError

ROOT=Path(__file__).resolve().parents[2];TAG='fundproject-private-forum-cache-v1'
class CacheHTTPError(RuntimeError):
 def __init__(self,status):self.status=status;super().__init__('GitHub cache request failed')

class StripAuthRedirect(HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  out=super().redirect_request(req,fp,code,msg,headers,newurl)
  if out:
   out.remove_header('Authorization')
  return out

def request(url,token,method='GET',body=None,binary=False):
 if not url.startswith(('https://api.github.com/','https://uploads.github.com/')):raise ValueError('Unexpected GitHub cache host')
 headers={'Accept':'application/octet-stream' if binary and method=='GET' else 'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','Authorization':'Bearer '+token}
 if body is not None:headers['Content-Type']='application/gzip' if binary else 'application/json';body=body if isinstance(body,bytes) else json.dumps(body).encode()
 try:
  with build_opener(StripAuthRedirect()).open(Request(url,headers=headers,data=body,method=method),timeout=90) as response:
   data=response.read(512_000_001)
 except HTTPError as exc:
  if exc.code==404 and not binary:return None
  raise CacheHTTPError(exc.code) from None
 if len(data)>512_000_000:raise ValueError('Corpus cache exceeded checkpoint capacity')
 return data if binary else json.loads(data) if data else None

def sync(mode,root=ROOT,token=None,repo=None):
 root=Path(root);token=token or os.environ.get('GITHUB_TOKEN');repo=repo or os.environ.get('GITHUB_REPOSITORY')
 if not token or not repo or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo):raise ValueError('Missing repository cache authorization')
 base='https://api.github.com/repos/'+repo;pointer_path=root/'prototype/dist/data/v10/corpus-pointer.json';folder=root/'prototype/.public-corpus/activity'
 if mode=='pull':
  if not pointer_path.exists():return dict(status='no-prior-checkpoint')
  pointer=json.loads(pointer_path.read_text());blob=request(base+'/releases/assets/'+str(int(pointer['assetId'])),token,binary=True)
  if hashlib.sha256(blob).hexdigest()!=pointer['sha256']:raise ValueError('Corpus checkpoint hash mismatch')
  # A bounded decode prevents a malformed checkpoint from expanding without limit.
  import io
  with gzip.GzipFile(fileobj=io.BytesIO(blob)) as zipped:raw=zipped.read(2_000_000_001)
  if len(raw)>2_000_000_000:raise ValueError('Corpus checkpoint expansion too large')
  data=json.loads(raw)
  if data.get('schemaVersion')!=1 or not isinstance(data.get('files'),dict):raise ValueError('Invalid corpus checkpoint')
  for name,value in data['files'].items():
   if not re.fullmatch(r'(?:funds|stocks)/\d{2}\.json',name) or not isinstance(value,dict):raise ValueError('Unexpected checkpoint path')
  from build_global_foundation import write
  for name,value in data['files'].items():write(folder/name,value)
  write(root/'prototype/.public-corpus/checkpoint.json',dict(assetId=pointer['assetId'],sha256=pointer['sha256']))
  return dict(status='restored',files=len(data['files']),bytes=len(blob))
 release=None
 if pointer_path.exists():
  prior=json.loads(pointer_path.read_text())
  if prior.get('releaseId'):release=request(base+'/releases/'+str(int(prior['releaseId'])),token)
 if release is None:
  releases=request(base+'/releases?per_page=100',token) or []
  release=next((r for r in releases if r.get('tag_name')==TAG),None)
 if release is None:release=request(base+'/releases',token,'POST',dict(tag_name=TAG,target_commitish='main',name='Private public-source corpus cache',body='Machine checkpoint storage. Public source text only; no portfolios, keys or account metadata.',draft=True,prerelease=False))
 if not release.get('draft'):raise ValueError('Corpus release must remain private draft')
 files={p.relative_to(folder).as_posix():json.loads(p.read_text()) for p in sorted(folder.rglob('*.json'))} if folder.exists() else {}
 if any(not re.fullmatch(r'(?:funds|stocks)/\d{2}\.json',name) for name in files):raise ValueError('Unexpected local corpus file')
 blob=gzip.compress(json.dumps(dict(schemaVersion=1,files=files),ensure_ascii=False,separators=(',',':')).encode(),compresslevel=6)
 if len(blob)>512_000_000:raise ValueError('Corpus checkpoint capacity reached; retain prior snapshot')
 previous_asset=json.loads(pointer_path.read_text()).get('assetId') if pointer_path.exists() else None
 now=datetime.now(timezone.utc);name='forum-corpus-'+now.strftime('%Y%m%dT%H%M%S')+'-'+hashlib.sha256(blob).hexdigest()[:12]+'.json.gz'
 endpoint='https://uploads.github.com/repos/'+repo+'/releases/'+str(release['id'])+'/assets?name='+name
 # Upload response is JSON although its request body is gzip.
 raw=request(endpoint,token,'POST',blob,binary=True);asset=json.loads(raw)
 if asset.get('size')!=len(blob):raise ValueError('Corpus upload size mismatch')
 digest=asset.get('digest')
 if digest and digest!='sha256:'+hashlib.sha256(blob).hexdigest():raise ValueError('Corpus upload digest mismatch')
 # Verify download before making the new pointer authoritative or deleting old assets.
 verify=request(base+'/releases/assets/'+str(asset['id']),token,binary=True)
 if hashlib.sha256(verify).hexdigest()!=hashlib.sha256(blob).hexdigest():raise ValueError('Uploaded corpus verification failed')
 from build_global_foundation import write
 write(pointer_path,dict(schemaVersion=1,releaseId=release['id'],assetId=asset['id'],sha256=hashlib.sha256(blob).hexdigest(),bytes=len(blob),updatedAt=now.isoformat(),access='private-draft-release',retention='rolling-30-days-corpus; latest-two-checkpoints'))
 write(root/'prototype/.public-corpus/checkpoint.json',dict(assetId=asset['id'],sha256=hashlib.sha256(blob).hexdigest()))
 assets=request(base+'/releases/'+str(release['id'])+'/assets?per_page=100',token) or []
 owned=sorted([a for a in assets if a.get('name','').startswith('forum-corpus-')],key=lambda a:a['id'],reverse=True)
 cleanup_pending=0
 for old in owned:
  if old['id'] in (asset['id'],previous_asset):continue
  try:request(base+'/releases/assets/'+str(old['id']),token,'DELETE')
  except RuntimeError:cleanup_pending+=1
 legacy=root/'prototype/dist/data/v08/forum.json'
 if legacy.exists():write(legacy,dict(schemaVersion=2,records=[],metrics=[],claims=[],retiredTo='private-draft-corpus; public results in v10/activity'))
 return dict(status='saved-and-verified',files=len(files),bytes=len(blob),checkpointAssetsRetained=1+bool(previous_asset),cleanupPending=cleanup_pending)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['pull','push']);p.add_argument('--root',type=Path,default=ROOT);a=p.parse_args()
 try:print(json.dumps(sync(a.mode,a.root),ensure_ascii=False))
 except Exception as exc:print(json.dumps(dict(status='failed',errorType=type(exc).__name__,httpStatus=getattr(exc,'status',None)),ensure_ascii=False));raise SystemExit(2)
