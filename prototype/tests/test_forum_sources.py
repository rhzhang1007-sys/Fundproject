import json,sys,unittest
from pathlib import Path
from datetime import datetime
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import refresh_public_data as u
import sina_forum as s
class Sources(unittest.TestCase):
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
if __name__=='__main__':unittest.main()
