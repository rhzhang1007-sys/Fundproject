import json,sys,unittest,tempfile
from unittest.mock import patch
from datetime import timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
from datetime import datetime
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import refresh_public_data as u
import sina_forum as s
class Sources(unittest.TestCase):
 def test_html_paragraphs_do_not_join_numbers(self):
  self.assertEqual(s.Tree('<div><p>10</p><p>20</p></div>').root.text(),'10 20')
 def test_reviewed_news_conflict_not_published(self):
  self.assertFalse(u.public_event_allowed({'sourceRecordId':'fast:202611223936892196'}))
  self.assertTrue(u.public_event_allowed({'sourceRecordId':'fast:other'}))
 def test_eastmoney_fallback_and_cross_board(self):
  payload={'rc':1,'re':[],'bar_code':'gssz','bar_info':{'QCode':'','Category':201}}
  with self.assertRaisesRegex(ValueError,'identity'):u._forum_payload(lambda _:json.dumps(payload),'516160',1)
  payload.update(bar_code='sh516160',bar_info={'QCode':'516160','Category':105},re=[{'stockbar_code':'sh516160'},{'stockbar_code':'yyhd'}])
  rows=u._forum_payload(lambda _:json.dumps(payload),'of516160',1)
  self.assertTrue(u.forum_native(rows[0],'of516160'));self.assertFalse(u.forum_native(rows[1],'of516160'))
  self.assertFalse(u.forum_native({'stockbar_code':'of000001'},'000001'))
 def test_sina_identity_encoding_and_reply_content(self):
  html='<meta charset="gb2312"><meta content="sz300750"><table><tr><td>10</td><td>1</td><td><a href="/?s=thread&bid=1&tid=2">真实标题</a></td><td>名字不保存</td><td>昨天15:00</td></tr></table>'
  text=s.read_html(lambda *a,**k:html.encode('gb18030'),'https://guba.sina.com.cn/')
  rows,_=s.listing(text,'sz300750','stock300750',datetime(2026,11,25,17));self.assertEqual(rows[0]['date'],'2026-11-24');self.assertNotIn('名字',str(rows))
  detail="<script>var pageConfig={bid:'1',tid:'2'}</script><div id='thread_content'>正文<strong>数字10</strong></div><div class='iltp_time'>昨天15:00</div><span>回复(1)</span><p id='pContent_2'>回复原文</p>"
  s.detail(detail,rows[0],datetime(2026,11,25,17));self.assertEqual(rows[0]['coverage']['comments'],'complete');self.assertIn('数字10',rows[0]['content']);self.assertEqual(rows[0]['comments'][0]['text'],'回复原文')
  with self.assertRaises(ValueError):s.listing(text,'sh600000','stock600000',datetime(2026,11,25,17))
 def test_known_sina_post_still_reads_body_without_listing(self):
  from forum_object import collect
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);folder=root/'prototype/dist/data/v10';folder.mkdir(parents=True);(folder/'objects.json').write_text(json.dumps({'objects':[{'id':'stock300750','kind':'stock','code':'300750'}]}))
   day=(datetime.now(ZoneInfo('Asia/Shanghai')).date()-timedelta(days=1)).isoformat();initial={'records':[{'id':'sina:1:2','source':'新浪股市汇','objectId':'stock300750','date':day,'url':'https://guba.sina.com.cn/?s=thread&bid=1&tid=2','coverage':{'body':'unknown','comments':'unknown'}}]}
   def detail(html,row,now):row.update(content='正文',comments=[],coverage={'body':'complete','comments':'complete'});return None
   with patch('forum_object.sina.read_html',return_value='public body') as read,patch('forum_object.sina.detail',side_effect=detail),patch('forum_object.sina.listing',side_effect=AssertionError('No list request')):
    value=collect(root,'stock300750',day,seconds=60,providers=('sina',),initial=initial,known_only=True,post_ids=['sina:1:2'])
   self.assertEqual(read.call_count,1);self.assertEqual(value['status'],'complete');self.assertEqual(value['records'][0]['content'],'正文')
if __name__=='__main__':unittest.main()
