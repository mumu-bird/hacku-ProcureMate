"""Collect the standard delivery rule independently from product prices."""
from urllib.request import Request, urlopen
from lxml import html
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json

url = 'https://shop.theclub.com.hk/shipping-policy?___store=en_US'
raw = urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read()
text = ' '.join(html.fromstring(raw.decode('utf-8')).text_content().split())
required = ['Home Delivery: HK$80', 'Net value is HK$400 or above per order']
if not all(term in text for term in required):
    raise ValueError('The policy changed or could not be read; review the source before updating fees.')
policy = {
    'id': 'club-standard-cash-home-delivery', 'sourceUrl': url,
    'observedAt': datetime.now(timezone.utc).isoformat(),
    'sourceDigest': sha256(raw).hexdigest(),
    'baseDeliveryCents': 8000, 'freeDeliveryThresholdCents': 40000,
    'currency': 'HKD',
    'scope': '普通现金商品、标准办公室派送；报价未使用积分、优惠券或其他折扣。',
    'summary': '标准派送 HK$80；符合页面条件的订单净额满 HK$400 免运费。',
    'limitations': '商品特殊派送、会员资格、实际可售库存与结账优惠未验证。当前测试商户采用此公开规则，不代表真实商户结账。'
}
root = Path(__file__).resolve().parent.parent
(root / 'data' / 'merchant-policy.json').write_text(json.dumps(policy, ensure_ascii=False, indent=2) + '\n')
print('Observed delivery policy:', policy['observedAt'])
