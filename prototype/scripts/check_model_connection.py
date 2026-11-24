"""One budgeted connectivity check. No portfolio, news, forum or user material is sent."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import json,time,os
import refresh_public_data as u


def run(root=u.ROOT):
    root=Path(root);day=datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat();data=root/'prototype/dist/data'
    request=u.load(root/'prototype/config/model-check-request.json',{}).get('requestId')
    prior=u.load(data/'v09/model-check.json',{})
    if prior.get('requestId')==request and prior.get('ok') is True and os.environ.get('GITHUB_EVENT_NAME')!='workflow_dispatch':return prior
    url,key,model=u.llm_config();u.init_llm(data/'v08/llm-usage'/f'{day}.json',day)
    started=time.monotonic();ok=False;reason='missing-model'
    if url and all(x is not None for x in u._price()):
        raw=u._post_llm(url,key,model,[dict(role='system',content='这是接口连通检查。仅返回JSON对象，不附加说明。'),dict(role='user',content='请返回 {"ok":true}。')],8192 if model.lower().startswith('glm-5.3') else 600)
        parsed=u.parse_json_loose(raw);ok=isinstance(parsed,dict) and parsed.get('ok') is True
        reason='validated-json-response' if ok else u.LLM_STATE.get('lastSkip') or 'unexpected-response'
    elif url:reason='missing-price'
    result=dict(requestId=request,checkedAt=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),ok=ok,reason=reason,latencySeconds=round(time.monotonic()-started,2),pricingSource=u.pricing_details()['source'],scope='interface-check-only; no business material; semantic quality not assessed')
    u.write_json(data/'v09/model-check.json',result);u.persist_usage()
    u.write_json(data/'v08/llm-usage.json',u.LLM_STATE)
    return result

if __name__=='__main__':
    result=run();print(json.dumps(result,ensure_ascii=False))
    if not result['ok']:raise SystemExit(2)
