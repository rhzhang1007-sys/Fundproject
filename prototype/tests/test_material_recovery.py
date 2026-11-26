import json,sys,unittest,tempfile,time
from pathlib import Path
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import refresh_public_data as u
from public_post_material import merge_material,hydrate
from sync_nav_observations import merge_point
from build_global_foundation import write
import forum_object
class Recovery(unittest.TestCase):
 def test_sparse_daily_row_preserves_known_growth_only_for_the_same_price(self):
  old=['2026-11-24',1.4079,1.4279,.99]
  self.assertEqual(merge_point(old,['2026-11-24',1.4079,1.4279,None]),old)
  self.assertIsNone(merge_point(old,['2026-11-24',1.41,1.43,None])[3])
 def test_body_failure_does_not_block_public_comments(self):
  row={'id':'12','date':'2026-11-25','url':'https://guba.eastmoney.com/news,of000001,12.html','commentCount':1,'comments':[],'coverage':{}}
  def fetch(url):
   if 'WebArticleNewReplyList' in url:return json.dumps({'rc':1,'count':1,'reply_total_count':1,'re':[{'reply_id':33,'reply_text':'取得的评论','reply_count':0,'child_replys':[]}]})
   raise RuntimeError('transport timeout')
  hydrate(fetch,row);self.assertEqual(row['comments'][0]['text'],'取得的评论');self.assertEqual(row['coverage']['comments'],'complete');self.assertIn('materialRetryAfter',row)
 def test_refresh_keeps_body_comments_and_invalidates_changed_comment_count(self):
  old={'id':'1','content':'已有完整正文','comments':[{'id':'c','text':'已有评论'}],'commentCount':1,'coverage':{'body':'complete','comments':'complete'},'commentCursor':{'done':True}}
  merged=merge_material(old,{'content':'','comments':[],'commentCount':2,'coverage':{'body':'missing','comments':'unknown'}})
  self.assertEqual(merged['content'],old['content']);self.assertEqual(merged['comments'],old['comments']);self.assertEqual(merged['coverage']['body'],'complete');self.assertNotIn('commentCursor',merged);self.assertNotEqual(merged['coverage']['comments'],'complete')
 def test_updated_listing_comment_count_invalidates_old_complete_state(self):
  from datetime import datetime,timedelta
  from zoneinfo import ZoneInfo
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);day=(datetime.now(ZoneInfo('Asia/Shanghai')).date()-timedelta(days=1)).isoformat();row={'id':'12','objectId':'stock000001','date':day,'source':'东方财富股吧','url':'https://guba.eastmoney.com/news,000001,12.html','content':'已有正文','commentCount':0,'comments':[],'coverage':{'body':'complete','comments':'complete'}}
   write(root/'prototype/dist/data/v10/objects.json',{'objects':[{'id':'stock000001','kind':'stock','code':'000001'}]})
   def fetch(url):
    if 'WebArticleNewReplyList' in url:return json.dumps({'rc':1,'count':1,'reply_total_count':1,'re':[{'reply_id':99,'reply_text':'新增评论','reply_count':0,'child_replys':[]}]})
    return json.dumps({'rc':1,'re':[{'post_id':12,'post_title':'原帖','post_publish_time':day+' 12:00:00','post_comment_count':1}]})
   with patch.object(forum_object,'CurlPublicFetcher',return_value=fetch):d=forum_object.collect(root,'stock000001',day,providers=('eastmoney',),initial={'records':[row],'sources':{}})
   self.assertEqual(d['records'][0]['commentCount'],1);self.assertEqual(d['records'][0]['comments'][0]['text'],'新增评论')
 def test_null_public_metadata_can_be_hydrated(self):
  row={'id':'12','date':'2026-11-25','url':'https://guba.eastmoney.com/news,of000001,12.html','coverage':None,'comments':None,'commentCount':0}
  hydrate(lambda url:'<div id="zwconbody">正文</div>',row);self.assertEqual(row['coverage']['body'],'complete');self.assertEqual(row['comments'],[])
 def test_wrong_post_identity_is_not_imported(self):
  with self.assertRaisesRegex(ValueError,'identity'):u.detail_record('<script>window.post_article={"post_id":99,"post_content":"错帖"};</script>',expected_post={'id':'12','date':'2026-11-25'})
 def test_known_post_skips_listing_and_uses_saved_public_url(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);day=(datetime.now(ZoneInfo('Asia/Shanghai')).date()-timedelta(days=1)).isoformat();r={'id':'12','objectId':'fund000001','date':day,'url':'https://guba.eastmoney.com/news,of000001,12.html','source':'东方财富股吧','commentCount':0,'comments':[],'coverage':{}}
   write(root/'prototype/dist/data/v10/objects.json',{'objects':[{'id':'fund000001','kind':'fund','code':'000001'}]});write(root/'prototype/dist/data/v12/posts/funds/000001.json',{'records':[r]});seen=[]
   def fetch(url):seen.append(url);return '<script>var post_article={"post_content":"真正正文"};</script>'
   with patch.object(forum_object,'CurlPublicFetcher',return_value=fetch):d=forum_object.collect(root,'fund000001',day,known_only=True,post_ids=['12'])
   self.assertEqual(seen,[r['url']]);self.assertEqual(d['records'][0]['content'],'真正正文');self.assertEqual(d['records'][0]['coverage']['comments'],'complete')
if __name__=='__main__':unittest.main()
