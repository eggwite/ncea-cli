#define MyAppName "NCEA CLI"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Eggwite"
#define MyAppURL "https://github.com/Eggwite/ncea-cli"

[Setup]
AppId={{7BCA11B7-F2C9-4C19-877E-A7E5B252DADF}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={userappdata}\ncea-cli
DisableDirPage=no
DefaultGroupName=NCEA CLI
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist\installer
OutputBaseFilename=ncea-cli-setup-win-x64
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: addtopath; Description: "Add NCEA CLI to PATH (recommended)"; GroupDescription: "Additional tasks:"
Name: desktopicon; Description: "Create a desktop shortcut"; GroupDescription: "Additional tasks:"; Flags: unchecked

[Files]
Source: "..\dist\ncea-cli.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\NCEA CLI"; Filename: "{app}\ncea-cli.exe"
Name: "{autodesktop}\NCEA CLI"; Filename: "{app}\ncea-cli.exe"; Tasks: desktopicon

[Code]

procedure AppendPathValue(AppPath: String);
var
  EnvPath: String;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', EnvPath) then
    EnvPath := '';
  if Pos(UpperCase(AppPath), UpperCase(EnvPath)) > 0 then
    Exit;
  if EnvPath = '' then
    EnvPath := AppPath
  else
    EnvPath := EnvPath + ';' + AppPath;
  RegWriteStringValue(HKCU, 'Environment', 'Path', EnvPath);
end;

procedure RemovePathValue(AppPath: String);
var
  EnvPath, NewPath, Part: String;
  startPos, sepPos: Integer;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', EnvPath) then
    Exit;
  NewPath := '';
  EnvPath := EnvPath + ';';
  startPos := 1;
  while startPos <= Length(EnvPath) do
  begin
    sepPos := Pos(';', Copy(EnvPath, startPos, Length(EnvPath)));
    if sepPos = 0 then Break;
    Part := Copy(EnvPath, startPos, sepPos - 1);
    startPos := startPos + sepPos;
    if CompareText(Trim(Part), AppPath) = 0 then Continue;
    if Part = '' then Continue;
    if NewPath = '' then
      NewPath := Part
    else
      NewPath := NewPath + ';' + Part;
  end;
  RegWriteStringValue(HKCU, 'Environment', 'Path', NewPath);
end;

procedure RefreshEnvironment;
begin
  RegWriteStringValue(
    HKCU,
    'Environment',
    '_NCEA_CLI_REFRESH_DUMMY',
    ''
  );
  RegDeleteValue(HKCU, 'Environment', '_NCEA_CLI_REFRESH_DUMMY');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if WizardIsTaskSelected('addtopath') then
    begin
      AppendPathValue(ExpandConstant('{app}'));
      RefreshEnvironment;
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    RemovePathValue(ExpandConstant('{app}'));
    RefreshEnvironment;
  end;
end;
