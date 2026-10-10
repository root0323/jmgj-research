; Only the NSIS installer writes this marker. Unpacked previews must never
; overwrite a user's installed app when testing the update menu.
!macro customInstall
  FileOpen $0 "$INSTDIR\resources\jmgj-installed.txt" w
  FileWrite $0 "nsis"
  FileClose $0
!macroend
