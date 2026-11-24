"""Public-only curl transport: system trust, bounded replies, pacing, refusals stop.
Model credentials never pass through curl command arguments; LLM calls use their own client.
"""
import subprocess
import time
from urllib.parse import urlencode,urlparse
from refresh_public_data import SourceRefused

class CurlPublicFetcher:
    def __init__(self,interval=1,timeout=25,deadline=None):
        self.interval=max(1,float(interval));self.timeout=timeout;self.previous=0;self.deadline=deadline;self.refused=False;self.calls=0
    def __call__(self,url,params=None,binary=False):
        if self.refused:raise SourceRefused('Public source refused; stop run')
        host=urlparse(url).hostname or ''
        if not host or not url.startswith('https://'):raise ValueError('Public feeds require HTTPS')
        referer=('https://emdatah5.eastmoney.com/' if host=='emdatah5.eastmoney.com' else
                 'https://fundf10.eastmoney.com/' if host=='api.fund.eastmoney.com' else
                 'https://guba.eastmoney.com/' if host in ('gbapi.eastmoney.com','guba.eastmoney.com') else
                 'https://stock.eastmoney.com/' if host.endswith('eastmoney.com') else
                 'https://www.csindex.com.cn/' if host.endswith('csindex.com.cn') else 'https://www.cninfo.com.cn/')
        last=None
        for attempt in range(3):
            if self.deadline and time.monotonic()+self.timeout>self.deadline:raise TimeoutError('Daily collection deadline reached')
            wait=self.interval-(time.monotonic()-self.previous)
            if wait>0:time.sleep(wait)
            self.previous=time.monotonic();self.calls+=1
            cmd=['curl','--silent','--show-error','--location','--max-time',str(self.timeout),'--compressed','--user-agent','Mozilla/5.0 FundprojectPublicResearch/1.0','--referer',referer,'--write-out','\n%{http_code}',url]
            if params is not None:cmd+=['--data',urlencode(params)]
            r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=self.timeout+5)
            content,_,status=r.stdout.rpartition(b'\n')
            if status in (b'401',b'403',b'429'):
                self.refused=True;raise SourceRefused('Public source refused ('+status.decode()+'); stop run')
            if len(content)>8_000_000:raise ValueError('Public response too large')
            if r.returncode==0 and status==b'200' and content:return content if binary else content.decode('utf-8-sig')
            last='HTTP '+status.decode(errors='replace') if status else 'transport failure'
            if attempt<2:time.sleep(1.5*(attempt+1))
        raise RuntimeError('Public source unavailable: '+str(last))
