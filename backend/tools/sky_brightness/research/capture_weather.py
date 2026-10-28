"""Capture the app's three-hour Meteoblue packages; never persist credentials."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path

import requests


def redact(value, secret):
    if isinstance(value, str):
        return value.replace(secret, '[redacted]')
    if isinstance(value, list):
        return [redact(item, secret) for item in value]
    if isinstance(value, dict):
        return {name: redact(item, secret) for name, item in value.items()
                if name.lower() not in ('apikey', 'api_key', 'authorization', 'access_token')}
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lat', type=float, required=True)
    parser.add_argument('--lon', type=float, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    key = os.environ.get('METEOBLUE_API_KEY', '').strip()
    if not key:
        raise SystemExit('METEOBLUE_API_KEY must be supplied in the process environment.')
    if args.output.exists():
        raise SystemExit('Output already exists; choose a new filename.')
    data, queries = {}, []
    for name, package in (('p2', 'airquality-3h'), ('p3', 'clouds-3h'), ('p4', 'air-3h')):
        try:
            response = requests.get('https://my.meteoblue.com/packages/' + package,
                                    params={'apikey': key, 'lat': args.lat, 'lon': args.lon,
                                            'tz': 'Asia/Seoul', 'format': 'json',
                                            'history_days': 4, 'forecast_days': 7},
                                    timeout=25, allow_redirects=False)
        except requests.RequestException:
            raise SystemExit(f'{package}: connection failed; no automatic retry.') from None
        if response.status_code != 200:
            raise SystemExit(f'{package}: HTTP {response.status_code}; no automatic retry.')
        try:
            payload = response.json()
        except ValueError:
            raise SystemExit(f'{package}: invalid JSON response; no automatic retry.') from None
        if not isinstance(payload, dict) or not any(isinstance(payload.get(block), dict)
                                                  for block in ('data_3h', 'data_1h')):
            raise SystemExit(f'{package}: no expected weather block; no automatic retry.')
        data[name] = redact(payload, key)
        queries.append({'package': package, 'status': response.status_code,
                        'credits_header': response.headers.get('MB-Credits-Accounted')})
    encoded = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    assert key not in encoded
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as handle:
        handle.write(encoded)
    receipt = {'fetched_at': datetime.now(timezone.utc).isoformat(),
               'plan': 'free3h', 'queries': queries, 'secrets_removed': True,
               'raw_response_scope': 'Complete successful package JSONs with credentials redacted; no field downsampling.'}
    with args.output.with_suffix('.receipt.json').open('x', encoding='utf-8') as handle:
        json.dump(receipt, handle, ensure_ascii=False, indent=2)
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == '__main__':
    main()
