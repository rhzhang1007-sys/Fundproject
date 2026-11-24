"""One budgeted connectivity check. No portfolio, news, forum or user material is sent."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import json,time,os
from urllib.parse import urlparse
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import refresh_public_data as u

def advertised_models(key,desired):
    """Documented metadata endpoint; never generate text or emit credentials."""
    req=Request('https://api.zhizengzeng.com/v1/models',headers={'Authorization':'Bearer '+key})
    try:
        with urlopen(req,timeout=25) as response:data=json.loads(response.read(2_000_001))
        items=data.get('data');ids={x.get('id') for x in items if isinstance(x,dict)} if isinstance(items,list) else set()
        return dict(httpStatus=200,validSchema=isinstance(items,list),desiredListed=desired in ids,listedKnownVariants=[x for x in ['glm-5.3-flashx','glm-5.3-flash'] if x in ids])
    except HTTPError as exc:return dict(httpStatus=exc.code)
    except (OSError,ValueError):return dict(httpStatus=None,error='directory-transport-or-schema')


def run(root=u.ROOT):
    root=Path(root);day=datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat();data=root/'prototype/dist/data'
    settings=u.load(root/'prototype/config/model-check-request.json',{});request=settings.get('requestId')
    prior=u.load(data/'v09/model-check.json',{})
    if prior.get('requestId')==request and prior.get('ok') is True and os.environ.get('GITHUB_EVENT_NAME')!='workflow_dispatch':return prior
    url,key,model=u.llm_config();u.init_llm(data/'v08/llm-usage'/f'{day}.json',day)
    u.MODEL_CIRCUIT_ERROR=None
    started=time.monotonic();ok=False;reason='missing-model';directory=None
    matches_model=not settings.get('expectedModels') or model and model.lower() in settings['expectedModels']
    matches_host=not settings.get('expectedHost') or url and urlparse(url).hostname==settings['expectedHost']
    if not matches_model:reason='configuration-model-name-mismatch'
    elif not matches_host:reason='configuration-provider-host-mismatch'
    elif url and all(x is not None for x in u._price()):
        directory=advertised_models(key,model)
        if directory.get('httpStatus') in (401,429,503):reason='model-directory-http-'+str(directory['httpStatus'])
        else:
            raw=u._post_llm(url,key,model,[dict(role='system',content='这是接口连通检查。仅返回JSON对象，不附加说明。'),dict(role='user',content='请返回 {"ok":true}。')],8192 if model.lower().startswith('glm-5.3') else 600)
            parsed=u.parse_json_loose(raw);ok=isinstance(parsed,dict) and parsed.get('ok') is True
            reason='validated-json-response' if ok else u.LLM_STATE.get('lastSkip') or 'unexpected-response'
    elif url:reason='missing-price'
    result=dict(requestId=request,checkedAt=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),ok=ok,reason=reason,error=u.LLM_STATE.get('lastError') if not ok else None,directory=directory,latencySeconds=round(time.monotonic()-started,2),pricingSource=u.pricing_details()['source'],expectedModel=bool(matches_model),expectedProvider=bool(matches_host),scope='interface-check-only; no business material; semantic quality not assessed')
    u.write_json(data/'v09/model-check.json',result);u.persist_usage()
    u.write_json(data/'v08/llm-usage.json',u.LLM_STATE)
    return result

if __name__=='__main__':
    result=run();print(json.dumps(result,ensure_ascii=False))
    if not result['ok']:raise SystemExit(2)
