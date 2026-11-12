// European Portuguese, informal "tu" like the other XKYRIVER apps. Never
// "você" or "o seu". Vocabulary: "cópia de segurança", "palavra-passe".

export const ptPT: Record<string, string> = {
  // Shell
  Home: 'Início',
  Restore: 'Restaurar',
  Settings: 'Definições',
  Sections: 'Secções',
  Language: 'Idioma',
  Privacy: 'Privacidade',
  'Loading…': 'A carregar…',
  Dismiss: 'Fechar',
  'This browser is not supported': 'Este navegador não é suportado',
  'Open XkyHold in a recent version of Chrome, Edge, Firefox or Safari.':
    'Abre o XkyHold numa versão recente do Chrome, Edge, Firefox ou Safari.',
  'Today, {time}': 'Hoje, {time}',
  'Yesterday, {time}': 'Ontem, {time}',
  '{files} files': '{files} ficheiros',

  // Errors
  'That is not the right password or recovery key.': 'A palavra-passe ou a chave de recuperação não está correta.',
  'Your Google session expired.': 'A tua sessão Google expirou.',
  'Part of this backup is damaged or missing in Google Drive.':
    'Parte desta cópia de segurança está danificada ou em falta no Google Drive.',
  'A folder could not be read. Check that it still exists.': 'Não foi possível ler uma pasta. Verifica se ainda existe.',
  'Google Drive refused the request. Your Drive may be full.':
    'O Google Drive recusou o pedido. O teu Drive pode estar cheio.',
  'Could not reach Google Drive. Check your connection and try again.':
    'Não foi possível contactar o Google Drive. Verifica a ligação e tenta novamente.',
  'Stopped.': 'Interrompido.',
  'Something went wrong. Please try again.': 'Algo correu mal. Tenta novamente.',
  'Your browser blocked the Google window. Allow pop-ups for this site and try again.':
    'O navegador bloqueou a janela do Google. Permite janelas pop-up para este site e tenta novamente.',
  'Could not sign in to Google. Please try again.': 'Não foi possível iniciar sessão no Google. Tenta novamente.',
  'This is not an XkyHold backup, or it was made by a newer version.':
    'Isto não é uma cópia de segurança do XkyHold, ou foi feita por uma versão mais recente.',
  'A backup with this name already exists. Choose another name.':
    'Já existe uma cópia de segurança com este nome. Escolhe outro nome.',
  'Choose at least one folder to save, in Settings.': 'Escolhe pelo menos uma pasta a guardar, nas Definições.',
  'XkyHold needs your permission to read your folders again.':
    'O XkyHold precisa novamente da tua permissão para ler as pastas.',

  // Notices
  'Backup complete: {files} files, {sent} sent to Google Drive.':
    'Cópia concluída: {files} ficheiros, {sent} enviados para o Google Drive.',
  '{n} could not be read.': 'Não foi possível ler {n}.',
  'Restored {files} files ({size}).': '{files} ficheiros restaurados ({size}).',
  'Checked {files} files ({size}): every one is intact.': '{files} ficheiros verificados ({size}): estão todos intactos.',
  '{platform} computer': 'Computador {platform}',
  'My computer': 'O meu computador',

  // Wizard
  'Step {n} of {total}': 'Passo {n} de {total}',
  'Keep your files safe': 'Mantém os teus ficheiros seguros',
  'XkyHold saves the folders you choose to your own Google Drive. Your files are encrypted on this computer first, so only you can read them.':
    'O XkyHold guarda as pastas que escolheres no teu próprio Google Drive. Os ficheiros são encriptados primeiro neste computador, por isso só tu os podes ler.',
  'This browser can restore files from a backup. To make backups, open XkyHold in Chrome or Edge on a computer.':
    'Este navegador pode restaurar ficheiros de uma cópia de segurança. Para fazer cópias, abre o XkyHold no Chrome ou no Edge num computador.',
  'Waiting for Google…': 'À espera do Google…',
  'Continue with Google': 'Continuar com o Google',
  'XkyHold can only see the files it creates in your Drive. Nothing else.':
    'O XkyHold só vê os ficheiros que ele próprio cria no teu Drive. Mais nada.',
  'Your backup': 'A tua cópia de segurança',
  'Looking for your backups…': 'À procura das tuas cópias de segurança…',
  'Try again': 'Tentar novamente',
  'Connect to a backup you already have, or start a new one.': 'Liga-te a uma cópia que já tens, ou começa uma nova.',
  'Start a new backup': 'Começar uma cópia nova',
  'There is no backup in this Google account yet.': 'Ainda não há nenhuma cópia de segurança nesta conta Google.',
  'Name of this backup': 'Nome desta cópia de segurança',
  'Use a different name on each computer.': 'Usa um nome diferente em cada computador.',
  Continue: 'Continuar',
  Back: 'Voltar',
  'Folders to save': 'Pastas a guardar',
  'Choose the folders you want to keep safe. When the browser asks, pick “Allow on every visit” so you are not asked again.':
    'Escolhe as pastas que queres manter seguras. Quando o navegador perguntar, escolhe “Permitir em todas as visitas” para ele não voltar a perguntar.',
  'Protect your backup': 'Protege a tua cópia de segurança',
  'Your files are encrypted with this password before they leave this computer.':
    'Os ficheiros são encriptados com esta palavra-passe antes de saírem deste computador.',
  Password: 'Palavra-passe',
  'Confirm password': 'Confirmar palavra-passe',
  'Use at least {n} characters.': 'Usa pelo menos {n} caracteres.',
  'The two passwords are different.': 'As duas palavras-passe são diferentes.',
  'Next you will get a recovery key, in case you forget this password.':
    'A seguir recebes uma chave de recuperação, para o caso de te esqueceres desta palavra-passe.',
  'Creating your backup…': 'A criar a cópia de segurança…',
  'Create backup': 'Criar cópia de segurança',
  'Save your recovery key': 'Guarda a tua chave de recuperação',
  'If you forget your password, this key is the only other way to open your backup. It is shown only once.':
    'Se te esqueceres da palavra-passe, esta chave é a única outra forma de abrir a cópia de segurança. Só é mostrada uma vez.',
  Download: 'Transferir',
  Print: 'Imprimir',
  Copy: 'Copiar',
  Copied: 'Copiado',
  'I have saved my recovery key somewhere safe': 'Guardei a minha chave de recuperação num local seguro',
  Finish: 'Concluir',
  'Open “{name}”': 'Abrir “{name}”',
  'Recovery key': 'Chave de recuperação',
  'Use my password instead': 'Usar a palavra-passe',
  'I forgot my password': 'Esqueci-me da palavra-passe',
  'Opening your backup…': 'A abrir a cópia de segurança…',
  'Open backup': 'Abrir cópia de segurança',
  'XkyHold recovery key': 'Chave de recuperação do XkyHold',
  Backup: 'Cópia de segurança',
  'Keep this somewhere safe, away from your computer. Anyone who has it can open your backup.':
    'Guarda isto num local seguro, longe do computador. Quem a tiver pode abrir a tua cópia de segurança.',

  // Folders
  'No folders chosen yet.': 'Ainda não escolheste nenhuma pasta.',
  'Needs your permission to be read': 'Precisa da tua permissão para ser lida',
  'Counting files…': 'A contar ficheiros…',
  Allow: 'Permitir',
  Remove: 'Remover',
  'Remove {name}': 'Remover {name}',
  'Add folder…': 'Adicionar pasta…',
  'That folder cannot be used. Choose a folder such as Documents or Pictures.':
    'Essa pasta não pode ser usada. Escolhe uma pasta como Documentos ou Imagens.',

  // Home
  'Connect to Google Drive to back up or restore.': 'Liga-te ao Google Drive para fazer cópias ou restaurar.',
  'Your backup could not be opened.': 'Não foi possível abrir a cópia de segurança.',
  'Backing up…': 'A fazer a cópia de segurança…',
  Stop: 'Parar',
  'Keep this page open until the backup finishes.': 'Mantém esta página aberta até a cópia terminar.',
  'Your files are safe': 'Os teus ficheiros estão seguros',
  'Last backup: {when}': 'Última cópia: {when}',
  'Welcome back': 'Olá de novo',
  'Connect to Google Drive to see your backups.': 'Liga-te ao Google Drive para ver as tuas cópias de segurança.',
  'No backup yet': 'Ainda sem cópia de segurança',
  'Make your first backup now.': 'Faz agora a tua primeira cópia.',
  'Back up now': 'Fazer cópia agora',
  'This browser can restore files. To make backups, open XkyHold in Chrome or Edge on a computer.':
    'Este navegador pode restaurar ficheiros. Para fazer cópias, abre o XkyHold no Chrome ou no Edge num computador.',
  '{n} files could not be read in the last backup.': 'Não foi possível ler {n} ficheiros na última cópia.',

  // Restore
  'Checking your backup…': 'A verificar a cópia de segurança…',
  'Restoring…': 'A restaurar…',
  'There is nothing to restore yet.': 'Ainda não há nada para restaurar.',
  'Pick a date to see what is inside.': 'Escolhe uma data para ver o que contém.',
  Check: 'Verificar',
  Location: 'Localização',
  'This folder is empty.': 'Esta pasta está vazia.',
  'Tick the files and folders you want back.': 'Assinala os ficheiros e as pastas que queres recuperar.',
  'Select all': 'Selecionar tudo',
  'Select none': 'Limpar seleção',
  'Download as .zip': 'Transferir em .zip',
  'Restore to a folder…': 'Restaurar para uma pasta…',
  'Restore {n} to a folder…': 'Restaurar {n} para uma pasta…',
  'Files restored to a folder get today’s date. A .zip keeps their original dates.':
    'Os ficheiros restaurados para uma pasta ficam com a data de hoje. O .zip mantém as datas originais.',
  'The .zip file keeps the original dates of your files.': 'O ficheiro .zip mantém as datas originais dos teus ficheiros.',
  '{files} files ({size}) are in a .zip file in your downloads.':
    '{files} ficheiros ({size}) estão num ficheiro .zip nas tuas transferências.',
  'There is not enough free space on this device for the .zip file.':
    'Não há espaço livre suficiente neste dispositivo para o ficheiro .zip.',

  // Reminder
  'You have not made a backup yet.': 'Ainda não fizeste nenhuma cópia de segurança.',
  'Your last backup was more than a day ago.': 'A última cópia de segurança foi há mais de um dia.',
  'Your last backup was {n} days ago.': 'A última cópia de segurança foi há {n} dias.',
  'Not now': 'Agora não',
  'Time for a backup': 'Está na altura de fazer uma cópia',
  'Removing old backups…': 'A remover cópias antigas…',
  'Your new backup is already safe.': 'A nova cópia já está segura.',
  '{n} old backups removed.': '{n} cópias antigas removidas.',
  'Another device is using this backup right now. Try again in a few minutes.':
    'Outro dispositivo está a usar esta cópia de segurança neste momento. Tenta novamente dentro de alguns minutos.',

  // Settings
  Backups: 'Cópias de segurança',
  'Remind me to back up': 'Lembrar-me de fazer cópia',
  Never: 'Nunca',
  'Every day': 'Todos os dias',
  'Every week': 'Todas as semanas',
  'Every {n} days': 'A cada {n} dias',
  'XkyHold never starts a backup by itself. It tells you when one is due and you decide.':
    'O XkyHold nunca inicia uma cópia sozinho. Avisa quando está na altura e a decisão é tua.',
  'Keep backups': 'Manter cópias',
  Forever: 'Para sempre',
  'At least a year': 'Pelo menos um ano',
  'At least {n} months': 'Pelo menos {n} meses',
  'Older backups are removed after each new backup. They stay in the Google Drive trash for 30 days.':
    'As cópias mais antigas são removidas depois de cada nova cópia. Ficam 30 dias no lixo do Google Drive.',
  'Google Drive': 'Google Drive',
  'Backup “{name}”': 'Cópia de segurança “{name}”',
  'Sign out of Google': 'Terminar sessão no Google',
  'Change password…': 'Alterar palavra-passe…',
  'Change password': 'Alterar palavra-passe',
  'Current password': 'Palavra-passe atual',
  'New password': 'Nova palavra-passe',
  Cancel: 'Cancelar',
  'Your password was changed.': 'A palavra-passe foi alterada.',
  'This browser': 'Este navegador',
  'Removes XkyHold’s settings from this browser. Your backup stays in Google Drive, and you can connect to it again with your password.':
    'Remove as definições do XkyHold deste navegador. A cópia de segurança continua no Google Drive, e podes voltar a ligar-te a ela com a palavra-passe.',
  'Remove from this browser…': 'Remover deste navegador…',
  Terms: 'Termos',
  Contact: 'Contacto',
  'Source code': 'Código-fonte',
  'Yes, remove': 'Sim, remover',
}
