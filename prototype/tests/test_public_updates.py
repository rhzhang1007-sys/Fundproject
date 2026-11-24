import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from datetime import date

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/refresh_public_data.py'
spec = importlib.util.spec_from_file_location('updates', SCRIPT)
updates = importlib.util.module_from_spec(spec); spec.loader.exec_module(updates)


def event(id='a', day='2026-11-20', url='https://example.com/a'):
    return dict(id=id, entityCode='300750', title='公告甲', date=day, url=url, source='公开来源')


class PublicUpdates(unittest.TestCase):
    def test_exact_duplicates_preserve_source_links(self):
        active, archive = updates.merge_events([event()], [event('b', url='https://example.com/b')], date(2026, 11, 23))
        self.assertEqual(len(active), 1); self.assertEqual(len(active[0]['sources']), 2); self.assertFalse(archive)
    def test_old_is_archived_and_future_is_rejected(self):
        active, archive = updates.merge_events([event(day='2026-10-01')], [], date(2026, 11, 23))
        self.assertFalse(active); self.assertEqual(len(archive['2026-10']), 1)
        with self.assertRaises(ValueError): updates.merge_events([], [event(day='2026-12-01')], date(2026, 11, 23))
    def test_offline_run_has_no_network_and_preserves_source_check_date(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); p=root/'prototype/dist/data/v07/events.json'; p.parent.mkdir(parents=True)
            p.write_text(json.dumps({'builtAt':'2026-10-01T00:00:00+08:00','events':[event(day='2026-10-01')]}))
            summary=updates.run(root, {'windowDays':30}, as_of=date(2026,11,23))
            self.assertFalse(summary['networkUsed']);self.assertEqual(json.loads(p.read_text())['builtAt'],'2026-10-01T00:00:00+08:00')
            self.assertEqual(len(json.loads((root/'prototype/dist/data/archive/2026-10.json').read_text())['events']),1)
    def test_collection_cannot_run_without_explicit_enabled_config(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError): updates.run(Path(temp),{'enabled':False},collect=True)
    def test_forum_metadata_does_not_invent_authors_counts_or_publication_date(self):
        parser=updates.ForumLinks('300750','2026-11-23');parser.feed('<a href="/news,300750,123.html">公告标题</a>')
        self.assertEqual(len(parser.rows),1);self.assertIsNone(parser.rows[0]['date']);self.assertIsNone(parser.rows[0]['readCount']);self.assertNotIn('author',parser.rows[0])

    def test_simulated_forum_collection_keeps_event_check_date_and_unknown_counts(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);p=root/'prototype/dist/data/v07/events.json';p.parent.mkdir(parents=True)
            p.write_text(json.dumps({'builtAt':'2026-10-01T00:00:00+08:00','events':[]}))
            config={'enabled':True,'objects':[{'kind':'stock','code':'300750','name':'测试公司'}],'sources':{'forumLists':True},'maxPagesPerObject':1}
            pages=iter([{'re':[{'post_id':'123','post_title':'公告标题','post_publish_time':'2026-11-22 12:00:00'}]},{'re':[]}])
            with patch.object(updates,'Fetcher',return_value=lambda *a,**k:json.dumps(next(pages))):
                updates.run(root,config,collect=True,as_of=date(2026,11,23))
            forum=json.loads((root/'prototype/dist/data/v08/forum.json').read_text())
            self.assertEqual(forum['metrics'][0]['sampledPosts'],1)
            self.assertIsNone(forum['metrics'][0]['zScore'])
            self.assertIsNone(forum['metrics'][0]['readCount'])
            self.assertEqual(json.loads(p.read_text())['builtAt'],'2026-10-01T00:00:00+08:00')
    def test_unadapted_dynamic_forum_page_does_not_replace_existing_files(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);p=root/'prototype/dist/data/v07/events.json';p.parent.mkdir(parents=True)
            original=json.dumps({'builtAt':'2026-10-01','events':[event()]});p.write_text(original)
            config={'enabled':True,'objects':[{'kind':'fund','code':'516160','name':'测试基金'}],'sources':{'forumLists':True}}
            with patch.object(updates,'Fetcher',return_value=lambda *a,**k:'<div>动态列表</div>'):
                with self.assertRaises(ValueError): updates.run(root,config,collect=True,as_of=date(2026,11,23))
            self.assertEqual(p.read_text(),original)

    def test_public_preparation_excludes_old_portfolio_defaults_and_record_ui(self):
        builder_path=SCRIPT.with_name('prepare_v08_public_site.py')
        spec=importlib.util.spec_from_file_location('builder',builder_path);builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
        with tempfile.TemporaryDirectory() as temp:
            dest=Path(temp)/'site';builder.prepare(Path(__file__).resolve().parents[2],dest)
            self.assertNotIn('defaults',json.loads((dest/'data/v07/portfolio.json').read_text()))
            self.assertNotIn('defaultWeights',json.loads((dest/'data/catalog.json').read_text()))
            self.assertFalse((dest/'v07-history.mjs').exists())
            self.assertFalse((dest/'index-v06.html').exists())
            self.assertFalse((dest/'team-hub.html').exists())


if __name__ == '__main__': unittest.main()
