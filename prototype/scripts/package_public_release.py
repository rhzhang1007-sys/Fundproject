"""Prepare one current public delivery from a strict allowlist; no deployment or secrets."""
import hashlib,json,shutil,zipfile
from pathlib import Path
from prepare_v08_public_site import prepare

ROOT=Path(__file__).resolve().parents[2]

def build(root=ROOT):
 root=Path(root);stage=root/'tmp/global-coverage-2026-11-24/public-release';output=root/'output/持仓知见-当前公开交付'
 if stage.exists():shutil.rmtree(stage)
 stage.mkdir(parents=True);output.mkdir(parents=True,exist_ok=True);prepare(root,stage/'prototype/dist')
 files=['.github/workflows/'+n for n in ['daily-public-data.yml','global-forum.yml','check-model.yml','publish-pages.yml','daily-nav.yml']]
 files+=['prototype/config/'+n for n in ['public-updates.json','llm-pricing.json','model-check-request.json','global-forum-bootstrap.json']]
 files+=['prototype/scripts/'+n for n in ['refresh_public_data.py','public_news.py','public_transport.py','market_public.py','daily_pipeline.py','prepare_v08_public_site.py','check_model_connection.py','build_global_foundation.py','global_forum.py','public_comments.py','publish_object_activity.py','news_llm_queue.py','github_corpus_cache.py','package_public_release.py','collect_nav_snapshot.py','sync_nav_observations.py','compute_daily_factors.py','update_market_observations.py']]
 files+=['prototype/tests/'+n for n in ['test_public_updates.py','test_public_updates_regressions.py','test_news_pipeline.py','test_global_pipeline.py','test_global_corpus.py','v08-model.test.mjs','v08-ai.test.mjs','v09-industry.test.mjs','v09-public-data.test.mjs','v10-objects.test.mjs','web-ai-server.test.mjs','test_daily_factors.py']]
 files+=['prototype/scripts/import_overnight_data.py','prototype/tests/test_overnight_import.py','prototype/tests/v11-integration.test.mjs','prototype/dist/v09-industry.mjs']
 files+=['prototype/web-ai-server.mjs','prototype/serve.py','prototype/.env.example','prototype/requirements-daily.txt','docs/默认AI与自选AI配置.md','docs/全市场对象与定时更新架构.md','docs/持仓分析指标体系-v2.md']
 for name in files:
  target=stage/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/name,target)
 (stage/'.gitignore').write_text('.DS_Store\n__pycache__/\n*.pyc\n.env\n.env.*\n!**/.env.example\n**/.private/\n**/.public-corpus/\n**/.runtime/\nnode_modules/\ntmp/\n')
 (stage/'README.md').write_text('''# 持仓知见 · 全目录对象与每日公开数据

当前网页可按需查找目录内28,405个基金代码、6,190个股票档案；基金28,202个有基础详情、203个保留无详情状态。此为来源目录范围，不是全部法律字段或完整真实持仓验收。基金基础没有行业配置字段，原两基金报告行业数据另存。

本机启动：`python3 prototype/serve.py`，推荐Node 22 LTS。服务端默认AI与网页自选AI已实现，新配置留空，步骤见[AI配置](docs/默认AI与自选AI配置.md)。Key、私人持仓、笔记和图片不在本包中。

新闻按批量来源抓取再打标签，未归属材料保留。论坛遍历统一目录并续跑，去掉119对象白名单；帖子正文及评论按对象分片下发，按需收藏或分析，实际覆盖见data/v10/coverage.json。已建档不表示素材全部采齐。只保留30天动态；只有标题的公告不生成全文摘要。

GitHub日更为北京时间08:30，论坛队列每20分钟继续，可能延迟。定时任务只采集新闻、帖子正文和评论，不再运行观点聚合或新闻模型。模型按用户选择在网页调用；专用prompt后续设计。后台完整语料使用Actions自带GITHUB_TOKEN保存私有draft release检查点，不会公开发布Release。新网页AI的Key仍须站方在服务端单独填写。

网站发布开关保持false，未修改Team Hub。已将2026-11-25验收的稳定持仓、净值观察和公告接入按需分片，默认最新一期，可切换报告日；100行上限不当成完整披露，原已核110行中报保留。缺失未补采，未修改或停止WorkBuddy采集。用户组合只留在各自浏览器。

分析按v2组织3主指标及结构、风险、承压、成本4组明细。仅前十大不算分散类指标；详细持仓按同报告期、已展开比例至少50%计算已收录部分。每日净值与因子工作流已补齐；分红与折算未核的净值保持来源观察，不用于总回报、风险贡献或历史回撤计算。行业映射因子已撤下。

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
 (output/'交付说明.md').write_text('本包由公开白名单生成，当前任务报告见 ../全市场对象与定时改造-2026-11-24/实施计划与续接.md 。网站未发布。新API留空，配置见包内docs/默认AI与自选AI配置.md。恢复前须保留远端最新账本和私有缓存指针。\n')
 return dict(files=len(manifest),bytes=sum(x['bytes'] for x in manifest),zipBytes=archive.stat().st_size,stage=str(stage),archive=str(archive))

if __name__=='__main__':print(json.dumps(build(),ensure_ascii=False))
