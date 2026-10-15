import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./ApiHelpWindow.module.css";

export function ApiHelpWindow({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className={styles.window} aria-labelledby={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={title}>API·키·토큰·계정 안내</h2><button type="button" aria-label="API 안내 닫기" onClick={onClose}>×</button></header>
    <div className={styles.content}>
      <p className={styles.flow}>Meteoblue 계정 만들기 → API 키 발급 → 앱에 키 적용 → 장소 선택 → 자료 불러오기</p>
      <dl>
        <div><dt>계정</dt><dd>서비스에 가입한 사용자 정보입니다. 로그인하면 API 키, 이용 권한, 남은 사용량과 만료일을 확인할 수 있습니다. AstroSky에는 계정 비밀번호를 입력하지 않습니다.</dd></div>
        <div><dt>API</dt><dd>프로그램이 다른 서비스에 자료를 요청하는 통로입니다. 이 앱은 선택한 장소의 기상 자료를 Meteoblue API로 요청하고, 받은 값을 관측 환경 계산에 사용합니다.</dd></div>
        <div><dt>API 키</dt><dd>어느 사용자의 권한과 사용량으로 요청할지 식별하는 비밀 문자열입니다. 계정에서 발급받은 키를 앱에 붙여 넣어 주세요. 다른 사람에게 공개하면 본인의 사용량이 차감될 수 있습니다.</dd></div>
        <div><dt>토큰</dt><dd>문맥에 따라 의미가 다릅니다. 인증 토큰은 서비스 접근을 허용하는 비밀 문자열이며, 사용량 토큰은 서비스가 정한 소비 단위입니다. Meteoblue 기상 조회의 사용량은 이 앱에서 ‘크레딧’으로 표시합니다. API 키 자체가 조회할 때마다 사라지는 것은 아닙니다.</dd></div>
        <div><dt>크레딧과 예상 횟수</dt><dd>자료 패키지마다 요청 비용이 다르므로 HTTP 요청 1회와 크레딧 1개는 같지 않습니다. 앱은 받은 차감 정보와 패키지 비용을 기준으로 남은 예상 조회 횟수를 계산합니다. 실제 잔액·권한·만료일은 Meteoblue 계정에서 확인해 주세요.</dd></div>
        <div><dt>캐시</dt><dd>이미 받은 자료를 기기에 저장해 다시 사용하는 방식입니다. 같은 장소의 24시간 이내 저장 기상 자료는 새 요청 없이 불러옵니다. ‘새 자료 요청’은 다시 API를 호출하므로 크레딧을 사용할 수 있습니다.</dd></div>
      </dl>
      <p>키를 적용하면 이 기기에 암호화해 저장하고 다음 실행 때 복원합니다. Windows·Android 앱은 운영체제의 보호 기능을 사용하고, 웹은 해당 브라우저의 암호화 저장소를 사용합니다. 기기 간 자동 공유는 하지 않습니다.</p>
      <p>‘API 키 연결 해제’는 이 기기에 저장한 키를 삭제합니다. 계정의 키를 폐기하거나 계정을 탈퇴하는 기능은 아닙니다. 키 복원만으로 새 기상 요청이나 크레딧 차감이 발생하지 않습니다.</p>
      <p className={styles.note}>시상·장소 검색·지형·야간광은 별도 자료 경로를 사용합니다. Meteoblue 키가 모든 서비스의 계정을 대신하지는 않습니다.</p>
    </div>
  </dialog>, document.body);
}
