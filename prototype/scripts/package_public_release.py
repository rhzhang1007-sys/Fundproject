"""Prepare one current public delivery from a strict allowlist; no deployment or secrets."""
import hashlib,json,shutil,zipfile
from pathlib import Path
from prepare_v08_public_site import prepare

ROOT=Path(__file__).resolve().parents[2]

def build(root=ROOT):
 root=Path(root);stage=root/'tmp/global-coverage-2026-11-24/public-release';output=root/'output/持仓知见-当前公开交付'
 if stage.exists():shutil.rmtree(stage)
 stage.mkdir(parents=True);output.mkdir(parents=True,exist_ok=True);prepare(root,stage/'prototype/dist')
 files=['.github/workflows/'+n for n in ['daily-public-data.yml','global-forum.yml','check-model.yml','publish-pages.yml','daily-nav.yml','daily-index.yml','forum-watchdog.yml','check-backend-image.yml']]
 files+=['prototype/config/'+n for n in ['public-updates.json','llm-pricing.json','model-check-request.json','global-forum-bootstrap.json','public-source-review.json']]
 files+=['prototype/scripts/'+n for n in ['refresh_public_data.py','public_news.py','public_transport.py','market_public.py','daily_pipeline.py','prepare_v08_public_site.py','check_model_connection.py','build_global_foundation.py','global_forum.py','public_comments.py','publish_object_activity.py','news_llm_queue.py','github_corpus_cache.py','package_public_release.py','collect_nav_snapshot.py','sync_nav_observations.py','compute_daily_factors.py','update_market_observations.py','publish_news_shards.py','build_index_metrics.py','update_resolved_indices.py','sina_forum.py','forum_object.py','sync_analysis_v3.py','collect_fast_news_daily.py']]
 files+=['prototype/tests/'+n for n in ['test_public_updates.py','test_public_updates_regressions.py','test_news_pipeline.py','test_global_pipeline.py','test_global_corpus.py','v08-model.test.mjs','v08-ai.test.mjs','v09-industry.test.mjs','v09-public-data.test.mjs','v10-objects.test.mjs','web-ai-server.test.mjs','test_daily_factors.py','test_index_observations.py','test_forum_sources.py','v13-analysis.test.mjs']]
 files+=['prototype/scripts/import_overnight_data.py','prototype/tests/test_overnight_import.py','prototype/tests/v11-integration.test.mjs','prototype/dist/v09-industry.mjs','prototype/dist/v13-analysis.mjs','prototype/tests/v14-analysis.test.mjs','prototype/scripts/build_holdings_shards.py','prototype/tests/test_holdings_shards.py','prototype/build-analysis-view.mjs','prototype/daily-runtime.mjs','docs/持仓分析与定时更新-v7.md']
 files+=['prototype/forum-service.mjs','prototype/web-ai-server.mjs','prototype/serve.py','prototype/.env.example','prototype/requirements-daily.txt','docs/默认AI与自选AI配置.md','docs/全市场对象与定时更新架构.md','docs/持仓分析指标体系-v2.md','docs/持仓分析与信息读取-v3.md']
 files+=['prototype/tests/initial-holdings.test.mjs','docs/初始持仓与TeamHub-v17.md','prototype/model-transport.mjs','prototype/build-research-view.mjs','prototype/tests/v16-research.test.mjs','docs/持仓研究指标-v16.md','prototype/news-service.mjs','prototype/repair-daily-nav.mjs','prototype/requirements-web.txt','prototype/sync-final-data.mjs','prototype/tests/v15-workspace.test.mjs','docs/柔和界面与正文AI-v15.md']
 files+=['prototype/scripts/forum_quality.py','prototype/scripts/forum_repair.py','prototype/scripts/forum_watchdog.py','prototype/tests/discussion-reliability.test.mjs','prototype/tests/test_forum_quality.py','docs/帖子分析与自动抽检-v19.md']
 files+=['prototype/scripts/public_post_material.py','prototype/tests/test_material_recovery.py','prototype/tests/ai-results.test.mjs','docs/数据覆盖与AI结果-v18.md']
 files+=['prototype/scripts/forum_schedule.py','prototype/scripts/forum_continue.py','prototype/tests/test_forum_schedule.py','prototype/tests/forum-service.test.mjs','prototype/tests/ai-result-policy.test.mjs','docs/五点采集与独立补读-v20.md']
 files+=['prototype/scripts/daily_dispatch.py','prototype/tests/test_daily_dispatch.py','docs/日更触发与补跑-v21.md']
 files+=['Dockerfile','.dockerignore','prototype/tests/service-api.test.mjs','docs/Pages与后台部署-v22.md']
 files+=['prototype/build-peer-comparison.mjs','prototype/tests/v24-comparison.test.mjs','prototype/tests/v24-ai-presentation.test.mjs','docs/AI表达与同类整体对比-v24.md']
 files+=['render.yaml','deploy/supabase-state.sql','prototype/cloud-state.mjs','prototype/public-data-cache.mjs','prototype/tests/cloud-state.test.mjs','prototype/tests/data-source.test.mjs','prototype/tests/test_pages_package.py','docs/免费部署操作步骤-v23.md']
 for name in files:
  target=stage/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/name,target)
 (stage/'.gitignore').write_text('.DS_Store\n__pycache__/\n*.pyc\n.env\n.env.*\n!**/.env.example\n**/.private/\n**/.public-corpus/\n**/.runtime/\nnode_modules/\ntmp/\n')
 (stage/'README.md').write_text('''# 持仓知见 · 全目录对象与每日公开数据

2026-11-27部署v23：Pages分层数据包、Render Free后台、Supabase Free状态库已准备。部署步骤见[免费部署](docs/免费部署操作步骤-v23.md)。首次打开直接显示九基金持仓，持仓分析加入尾部风险、滚动持有体验、明确对象的相似基金与同权重结构对照；所有计算来自现有验收数据。

当前网页可按需查找目录内28,405个基金代码、6,190个股票档案；基金28,202个有基础详情、203个保留无详情状态。此为来源目录范围，不是全部法律字段或完整真实持仓验收。基金基础没有行业配置字段，原两基金报告行业数据另存。

本机启动：`python3 prototype/serve.py`，推荐Node 22 LTS。服务端默认AI与网页自选AI已实现，新配置留空，步骤见[AI配置](docs/默认AI与自选AI配置.md)。Key、私人持仓、笔记和图片不在本包中。

新闻按批量来源抓取再打标签，未归属材料保留。论坛遍历统一目录并续跑，去掉119对象白名单；帖子正文及评论按对象分片下发，按需收藏或分析，实际覆盖见data/v10/coverage.json。已建档不表示素材全部采齐。只保留30天动态；只有标题的公告不生成全文摘要。

GitHub净值日更05:10、已解析指数05:20、新闻05:30（北京时间），论坛队列05:05切换昨日目标，每20分钟继续，部分批次主动续跑，可能延迟。定时任务只采集新闻、帖子正文和评论，不再运行观点聚合或新闻模型。模型按用户选择在网页调用；v7分析已有统一预设prompt。后台完整语料使用Actions自带GITHUB_TOKEN保存私有draft release检查点，不会公开发布Release。新网页AI的Key仍须站方在服务端单独填写。

网站发布开关保持false，未修改Team Hub。2026-11-26已复核并接入7422个持仓展示分片、13390份原始净值历史、12714份复权历史。默认最新一期，可切换报告日；100行上限不当成完整披露，原已核110行中报保留。缺失未补采，未修改或停止WorkBuddy采集。用户组合只留在各自浏览器。

网页改为柔和界面，分析先列三组九个模块，下方只显示所选模块。重叠可比较整个组合或任意两基金。历史指标使用通过净值口径筛查的来源观察；累计净值比值不当总回报。WB已修复展示分片串基金，本轮逐基金核对通过，仍保留原已核持仓。AI在原页显示进度，完成后保存到资料库并显示结果；事件先读取HTML/PDF正文，长文完整分段再整理。新增独立使用手册。定时保留错峰补跑、当天去重，并串联净值→指数→新闻。详见docs/柔和界面与正文AI-v15.md。

本包是当前代码和公开数据备份；恢复前先同步远端，不能覆盖较新的费用账本或队列指针。私有原文缓存不打入公开包，继续采集前由工作流恢复并校验。[架构和边界](docs/全市场对象与定时更新架构.md)
''')
 (stage/'部署步骤.md').write_text('''本交付包含公开代码和基础分片；是否已推送，以远端提交和工作流结果为准。网站发布关闭。

本机默认AI的填写和启动步骤见 docs/默认AI与自选AI配置.md，全范围及实际覆盖边界见 docs/全市场对象与定时更新架构.md。新网页Key留空，需站方私下配置并运行Node服务。

外置既有LLM_API_KEY Secret不用重填。原文缓存使用Actions自带GITHUB_TOKEN，不需额外API Key。恢复前先同步远端，保留较新的费用账本、缓存指针和队列状态；不要用本包旧快照覆盖它们。新工作流上线后仍须核验首次运行结果，不能用本地测试代替云端验收。
''')
 manifest=[]
 for p in sorted(stage.rglob('*')):
  if p.is_file():
   if p.name=='.env.local' or '.private' in p.parts or '.public-corpus' in p.parts or '.runtime' in p.parts:raise ValueError('Private runtime input in public package')
   manifest.append(dict(path=p.relative_to(stage).as_posix(),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()))
 (output/'公开文件清单.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 archive=output/'持仓知见-当前公开代码与资料.zip'
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
  for item in manifest:z.write(stage/item['path'],item['path'])
 with zipfile.ZipFile(archive) as z:
  if z.testzip():raise ValueError('Public archive integrity error')
 (output/'交付说明.md').write_text('本包由公开白名单生成，当前任务报告见 ../免费部署与Pages数据接入-2026-11-27/验收状态.json 。部署步骤见包内docs/免费部署操作步骤-v23.md。网站发布状态以验收记录为准。恢复前须保留远端最新账本和私有缓存指针。\n')
 return dict(files=len(manifest),bytes=sum(x['bytes'] for x in manifest),zipBytes=archive.stat().st_size,stage=str(stage),archive=str(archive))

if __name__=='__main__':print(json.dumps(build(),ensure_ascii=False))
