; An update reinstalls the app by removing the whole install folder first, which would also delete the
; sound files the user dropped into <install folder>\sounds. Copy them aside before that and put them back after.
; (A real uninstall doesn't pass --updated, so it still removes everything.)
!macro customUnInstall
  ${if} ${isUpdated}
    ${if} ${FileExists} "$INSTDIR\sounds\*.*"
      RMDir /r "$TEMP\retro-messenger-sounds-keep"
      CreateDirectory "$TEMP\retro-messenger-sounds-keep"
      CopyFiles /SILENT "$INSTDIR\sounds\*.*" "$TEMP\retro-messenger-sounds-keep"
    ${endif}
  ${endif}
!macroend

!macro customInstall
  ${if} ${FileExists} "$TEMP\retro-messenger-sounds-keep\*.*"
    CreateDirectory "$INSTDIR\sounds"
    CopyFiles /SILENT "$TEMP\retro-messenger-sounds-keep\*.*" "$INSTDIR\sounds"
    RMDir /r "$TEMP\retro-messenger-sounds-keep"
  ${endif}
!macroend
