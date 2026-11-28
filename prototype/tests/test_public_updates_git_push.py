import subprocess,sys,tempfile,unittest
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from git_publish_retry import publish
from forum_watchdog import decision

class PublishRetry(unittest.TestCase):
 def test_real_remote_race_preserves_both_collectors(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);remote=root/'remote.git';a=root/'a';b=root/'b'
   def git(cwd,*args):return subprocess.run(['git',*args],cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
   git(root,'init','--bare','--initial-branch=main',str(remote));git(root,'clone',str(remote),str(a))
   for work in [a]:git(work,'config','user.name','test');git(work,'config','user.email','test@example.invalid')
   (a/'base').write_text('base');git(a,'add','.');git(a,'commit','-m','base');git(a,'push','origin','main');git(root,'clone',str(remote),str(b))
   git(b,'config','user.name','test');git(b,'config','user.email','test@example.invalid')
   (a/'forum.json').write_text('forum');git(a,'add','.');git(a,'commit','-m','forum')
   raced=False
   def runner(args,**kwargs):
    nonlocal raced
    if args[1]=='push' and not raced:
     raced=True;(b/'news.json').write_text('news');git(b,'add','.');git(b,'commit','-m','news');git(b,'push','origin','main')
    return subprocess.run(args,**kwargs)
   result=publish(a,runner=runner,sleep=lambda _:None)
   self.assertEqual(result['attempts'],2);self.assertEqual(git(remote,'show','main:forum.json').stdout,'forum');self.assertEqual(git(remote,'show','main:news.json').stdout,'news')
 def test_permission_failure_is_not_retried(self):
  calls=[]
  def run(args,**kw):
   calls.append(args);return subprocess.CompletedProcess(args,1 if args[1]=='push' else 0,'','permission denied')
  with self.assertRaisesRegex(RuntimeError,'non-concurrency'):publish('.',runner=run,sleep=lambda _:self.fail('sleep'))
  self.assertEqual(sum(x[1]=='push' for x in calls),1)
 def test_race_retry_is_bounded_and_never_force_pushes(self):
  calls=[]
  def run(args,**kw):
   calls.append(args);return subprocess.CompletedProcess(args,1 if args[1]=='push' else 0,'','[rejected] fetch first')
  with self.assertRaisesRegex(RuntimeError,'bounded retry'):publish('.',attempts=3,runner=run,sleep=lambda _:None)
  self.assertEqual(sum(x[1]=='push' for x in calls),3);self.assertTrue(all('--force' not in x for x in calls))
 def test_rebase_conflict_stops_before_push(self):
  calls=[]
  def run(args,**kw):
   calls.append(args);return subprocess.CompletedProcess(args,0 if args[1:]==['rebase','--abort'] else 1,'','conflict')
  with self.assertRaisesRegex(RuntimeError,'rebase'):publish('.',runner=run,sleep=lambda _:self.fail('sleep'))
  self.assertEqual(calls[-1],['git','rebase','--abort']);self.assertFalse(any(x[1]=='push' for x in calls))
 def test_failed_collector_gets_event_retry_with_loop_limit(self):
  now=datetime(2026,11,28,7,50,tzinfo=timezone.utc);r={'id':1,'status':'completed','conclusion':'failure','updated_at':'2026-11-28T07:49:00Z'}
  self.assertEqual(decision([r],now)['reason'],'retry-failed-collector');self.assertTrue(decision([r,r],now)['dispatch']);self.assertFalse(decision([r,r,r],now)['dispatch'])
  self.assertFalse(decision([r,{'status':'queued'}],now)['dispatch'])

if __name__=='__main__':unittest.main()
