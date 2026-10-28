"""Record confirmed rooftop conditions and select valid original measurements."""
from pathlib import Path
import pandas as pd

from prepare_joint_basis import write_json
from prepare_rooftop_basis import RESEARCH, DATASET
from calibrate_three_hour import sha256


def prepare():
    base = RESEARCH/'datasets'/DATASET
    target = base/'inputs/v001_valid_48.csv'
    condition = base/'raw/confirmed_conditions_v001.json'
    if target.exists() or condition.exists():
        raise ValueError('Do not overwrite confirmed conditions or selected inputs')
    raw = base/'raw/sqm_observations.csv'
    source = pd.read_csv(raw, keep_default_na=False)
    actual = pd.to_numeric(source['sqm_mag_arcsec2'], errors='coerce')
    assert len(source) == 49 and source.loc[actual.isna(), 'observation_id'].tolist() == [21]
    inherited = source['raw_time_label'].replace('', pd.NA).ffill()
    assert inherited.tolist() == source['time_kst'].tolist()
    rows = []
    for index, row in source.iterrows():
        if pd.isna(actual.iloc[index]):
            continue
        rows.append({'observation_id': int(row['observation_id']), 'lat': 33.42642, 'lon': 126.53016,
                     'time': row['date']+' '+row['time_kst'],
                     'altitude': int(row['altitude_deg']), 'zen': 90-int(row['altitude_deg']),
                     'az': int(row['azimuth_deg']), 'actual_mag': float(actual.iloc[index]),
                     'local_moon_disk_visibility': 0.})
    pd.DataFrame(rows).to_csv(target, index=False)
    write_json(condition, {
        'dataset_id': DATASET, 'site': '제주과학고등학교 서쪽 건물 북쪽 부분 옥상, 사진의 파란 핀',
        'latitude': 33.42642, 'longitude': 126.53016,
        'location_method': '사용자 사진의 농구장·건물 외곽과 카카오 지도 핀을 수동 대조한 근사값; GPS 측량값 아님',
        'horizontal_uncertainty_m_assumption': 10,
        'map_reference': 'https://map.kakao.com/link/map/옥상근사,33.42642,126.53016',
        'registration_image_sha256': sha256(base/'raw/location_registration_map.png'),
        'confirmation': {'height': '건물 4층 높이, 정확한 미터값 미상',
                         'moon': '측정 21:13–21:23 내내 달 원반이 지붕에 가려짐',
                         'sky': '측정한 하늘 중심 방향은 가리지 않았음; 전체 빔의 각도별 가림은 미측정',
                         'time': '빈 칸은 바로 위 명시 시각을 이어받음; 각 분 안의 초는 미상'},
        'instrument': 'SQM-L, fixed 20-degree FWHM Gaussian response approximation',
        'timezone': 'Asia/Seoul', 'azimuth': 'North=0, East=90',
        'valid_count': 48, 'raw_slots': 49, 'missing_observation_ids': [21],
        'raw_sha256': sha256(raw), 'input_sha256': sha256(target),
        'baseline_parameter_artifact': 'models/joint-sos3d-twilight-2026.10.28/candidate_params.json',
        'baseline_source_commit': 'c23fbf4947860ec1e5672ebbc0801e5e200666d2',
        'application_modified': False,
    })
    print('Saved 48 valid observations with 11 inherited minute labels and confirmed roof conditions.')


if __name__ == '__main__':
    prepare()
