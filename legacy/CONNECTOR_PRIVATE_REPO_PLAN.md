# Connector + Private Core Plan

## 목표

- 마켓플레이스에는 `vscode-connector/` 기준의 단일 VSIX만 배포
- 실제 Cencurity runtime/UI/core 코드는 private source repo 에만 유지
- 사용자는 source 가 아니라 OS별 빌드 산출물만 다운로드받아 실행

## 최종 구조

1. private source repo 에서 core 를 개발
2. CI 가 Windows/macOS/Linux 용 standalone binary 생성
3. CI 가 release manifest JSON 과 artifact 를 배포 저장소에 업로드
4. 공개 VSIX 인 connector 가 manifest 를 읽어 현재 플랫폼 artifact 다운로드
5. connector 가 로컬에서 core 를 실행하고 `http://127.0.0.1:<port>` 로 연결

## 왜 이 구조가 맞는가

- 단일 VSIX 만으로 모든 OS 대응 가능
- 공개 확장에 소스코드나 핵심 런타임 JS 를 싣지 않음
- VSIX 용량을 작게 유지하면서 core 는 독립 배포 가능
- main product 의 기존 구조와 공개 patch-only repo 는 건드리지 않음

## Manifest 계약

최소 규격:

```json
{
	"version": "1.0.3",
	"artifacts": {
		"win32-x64": {
			"url": "https://...",
			"sha256": "...",
			"fileName": "cencurity-core.exe"
		},
		"darwin-arm64": {
			"url": "https://...",
			"sha256": "...",
			"fileName": "cencurity-core"
		}
	}
}
```

필수 항목:

- `version`: 설치/업데이트 판별용 버전
- `artifacts[platform-arch].url`: 다운로드 URL
- `artifacts[platform-arch].sha256`: 무결성 검증 값
- `artifacts[platform-arch].fileName`: 로컬 저장 파일명

## 권장 CI/CD 흐름

1. private repo push
2. GitHub Actions 또는 사내 CI 에서 멀티플랫폼 빌드
3. 각 artifact 에 대해 SHA-256 생성
4. manifest JSON 생성
5. artifact + manifest 를 다운로드 엔드포인트에 게시
6. connector 는 `manifestUrl` 만 바꿔 새 버전 배포 없이 업데이트 반영

## 운영 메모

- manifest URL 은 사설 CDN, signed URL, API gateway 뒤에 둘 수 있음
- 필요하면 connector 에서 추후 인증 헤더/토큰 주입을 추가할 수 있음
- 현재 구현은 `serve --host --port` 와 `/healthz` 엔드포인트를 런타임 계약으로 가정함
