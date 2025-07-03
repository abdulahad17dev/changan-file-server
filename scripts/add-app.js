#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { program } = require('commander');
const chalk = require('chalk');

// ASCII art для красоты
const figlet = require('figlet');

console.log(chalk.cyan(figlet.textSync('Chang\'an', { horizontalLayout: 'full' })));
console.log(chalk.green('🚗 App Store - Add New App Tool\n'));

program
  .name('add-app')
  .description('Add new application to Chang\'an App Store')
  .version('1.0.0');

program
  .option('-n, --name <name>', 'Application name')
  .option('-p, --package <package>', 'Android package name')
  .option('-d, --developer <developer>', 'Developer name')
  .option('-c, --category <category>', 'App category (1=video, 7=music, etc.)')
  .option('-s, --slogan <slogan>', 'App slogan')
  .option('-desc, --description <description>', 'App description')
  .option('-v, --version <version>', 'App version', '1.0.0')
  .option('-apk, --apk-file <path>', 'Path to APK file')
  .option('-i, --icon <path>', 'Path to icon file')
  .option('--featured', 'Mark as featured app', false)
  .option('--interactive', 'Interactive mode', false);

program.parse();

const options = program.opts();

// Путь к папке приложений
const APPS_STORE_PATH = path.join(__dirname, '..', 'apps', 'store');
const STATIC_PATH = path.join(__dirname, '..', 'static');

// Проверяем существование папок
if (!fs.existsSync(APPS_STORE_PATH)) {
  fs.mkdirSync(APPS_STORE_PATH, { recursive: true });
}

// Функция генерации ID приложения
function generateAppId() {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2, 8);
  return timestamp + random;
}

// Функция создания безопасного имени папки
function createSafeFolderName(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // Удаляем спецсимволы
    .replace(/\s+/g, '-')          // Пробелы в дефисы
    .replace(/-+/g, '-')           // Множественные дефисы в одинарные
    .replace(/^-|-$/g, '');        // Убираем дефисы в начале и конце
}

// Функция расчета MD5 хеша файла
function calculateFileHash(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('md5');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

// Функция получения размера файла
function getFileSize(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  const stats = fs.statSync(filePath);
  return stats.size;
}

// Функция создания структуры приложения
async function createAppStructure(appData) {
  const appId = generateAppId();
  const folderName = createSafeFolderName(appData.name);
  const appPath = path.join(APPS_STORE_PATH, folderName);
  
  console.log(chalk.blue(`📁 Creating app structure for: ${appData.name}`));
  console.log(chalk.gray(`   App ID: ${appId}`));
  console.log(chalk.gray(`   Folder: ${folderName}`));
  
  // Создаем основную папку приложения
  if (fs.existsSync(appPath)) {
    console.log(chalk.yellow(`⚠️  App folder already exists: ${folderName}`));
    const timestamp = Date.now();
    const newFolderName = `${folderName}-${timestamp}`;
    const newAppPath = path.join(APPS_STORE_PATH, newFolderName);
    console.log(chalk.yellow(`   Using: ${newFolderName}`));
    appPath = newAppPath;
    folderName = newFolderName;
  }
  
  fs.mkdirSync(appPath, { recursive: true });
  
  // Создаем подпапки
  const releasesPath = path.join(appPath, 'releases', appData.version);
  const screenshotsPath = path.join(appPath, 'screenshots');
  
  fs.mkdirSync(releasesPath, { recursive: true });
  fs.mkdirSync(screenshotsPath, { recursive: true });
  
  // Создаем статические папки если нужно
  const staticIconsPath = path.join(STATIC_PATH, 'icons', folderName);
  const staticApksPath = path.join(STATIC_PATH, 'apks', folderName, appData.version);
  const staticScreenshotsPath = path.join(STATIC_PATH, 'screenshots', folderName);
  
  fs.mkdirSync(staticIconsPath, { recursive: true });
  fs.mkdirSync(staticApksPath, { recursive: true });
  fs.mkdirSync(staticScreenshotsPath, { recursive: true });
  
  // Копируем APK файл если указан
  let apkInfo = null;
  if (appData.apkFile && fs.existsSync(appData.apkFile)) {
    const apkFileName = 'app.apk';
    const targetApkPath = path.join(releasesPath, apkFileName);
    const staticApkPath = path.join(staticApksPath, apkFileName);
    
    console.log(chalk.blue(`📱 Copying APK file...`));
    fs.copyFileSync(appData.apkFile, targetApkPath);
    fs.copyFileSync(appData.apkFile, staticApkPath);
    
    apkInfo = {
      version: appData.version,
      version_number: parseVersionNumber(appData.version),
      apk_filename: apkFileName,
      file_size: getFileSize(targetApkPath),
      hash_code: calculateFileHash(targetApkPath),
      hash_type: "md5",
      release_notes: `Initial release version ${appData.version}`,
      min_android_version: "5.0",
      target_android_version: "13.0",
      permissions: ["INTERNET", "ACCESS_NETWORK_STATE"],
      released_at: new Date().toISOString()
    };
    
    console.log(chalk.green(`✅ APK copied and processed`));
    console.log(chalk.gray(`   Size: ${apkInfo.file_size} bytes`));
    console.log(chalk.gray(`   Hash: ${apkInfo.hash_code}`));
  }
  
  // Копируем иконку если указана
  if (appData.iconFile && fs.existsSync(appData.iconFile)) {
    const iconFileName = 'icon.png';
    const targetIconPath = path.join(appPath, iconFileName);
    const staticIconPath = path.join(staticIconsPath, iconFileName);
    
    console.log(chalk.blue(`🖼️  Copying icon file...`));
    fs.copyFileSync(appData.iconFile, targetIconPath);
    fs.copyFileSync(appData.iconFile, staticIconPath);
    console.log(chalk.green(`✅ Icon copied`));
  }
  
  return { appId, folderName, appPath, apkInfo };
}

// Функция парсинга номера версии
function parseVersionNumber(version) {
  const parts = version.split('.').map(Number);
  return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
}

// Функция создания metadata.json
function createMetadataJson(appData, appId, folderName) {
  const metadata = {
    app_id: appId,
    name: appData.name,
    package_name: appData.package,
    developer: appData.developer || "Unknown Developer",
    category: appData.category || "99",
    type: appData.category || "99",
    slogan: appData.slogan || `${appData.name} - отличное приложение`,
    description: appData.description || `Описание для ${appData.name}`,
    tags: ["mobile", "android"],
    featured: appData.featured || false,
    restricted_state: 0,
    uninstall: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  return metadata;
}

// Основная функция добавления приложения
async function addApp() {
  try {
    console.log(chalk.blue('🚀 Starting app creation process...\n'));
    
    // Собираем данные о приложении
    const appData = {
      name: options.name || 'Sample App',
      package: options.package || 'com.example.sampleapp',
      developer: options.developer || 'Unknown Developer',
      category: options.category || '99',
      slogan: options.slogan,
      description: options.description,
      version: options.version || '1.0.0',
      apkFile: options.apkFile,
      iconFile: options.icon,
      featured: options.featured
    };
    
    // Валидация
    if (!appData.name) {
      console.log(chalk.red('❌ App name is required!'));
      console.log(chalk.gray('Use: --name "Your App Name"'));
      process.exit(1);
    }
    
    console.log(chalk.green('📋 App Information:'));
    console.log(chalk.gray(`   Name: ${appData.name}`));
    console.log(chalk.gray(`   Package: ${appData.package}`));
    console.log(chalk.gray(`   Developer: ${appData.developer}`));
    console.log(chalk.gray(`   Category: ${appData.category}`));
    console.log(chalk.gray(`   Version: ${appData.version}`));
    console.log(chalk.gray(`   Featured: ${appData.featured ? 'Yes' : 'No'}`));
    if (appData.apkFile) {
      console.log(chalk.gray(`   APK File: ${appData.apkFile}`));
    }
    if (appData.iconFile) {
      console.log(chalk.gray(`   Icon File: ${appData.iconFile}`));
    }
    console.log('');
    
    // Создаем структуру
    const { appId, folderName, appPath, apkInfo } = await createAppStructure(appData);
    
    // Создаем metadata.json
    console.log(chalk.blue('📝 Creating metadata.json...'));
    const metadata = createMetadataJson(appData, appId, folderName);
    const metadataPath = path.join(appPath, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(chalk.green('✅ metadata.json created'));
    
    // Создаем info.json для версии если есть APK
    if (apkInfo) {
      console.log(chalk.blue('📝 Creating version info.json...'));
      const versionInfoPath = path.join(appPath, 'releases', appData.version, 'info.json');
      fs.writeFileSync(versionInfoPath, JSON.stringify(apkInfo, null, 2));
      console.log(chalk.green('✅ info.json created'));
    }
    
    // Создаем пустой файл для скриншотов
    const readmePath = path.join(appPath, 'screenshots', 'README.md');
    fs.writeFileSync(readmePath, '# Screenshots\n\nAdd app screenshots here (PNG/JPEG format).\n');
    
    // Финальный отчет
    console.log('\n' + chalk.green('🎉 App successfully created!'));
    console.log(chalk.cyan('📁 App Location:'));
    console.log(chalk.gray(`   ${appPath}`));
    console.log('\n' + chalk.cyan('📋 Next Steps:'));
    console.log(chalk.gray('   1. Add screenshots to: screenshots/ folder'));
    console.log(chalk.gray('   2. Start server: npm start'));
    console.log(chalk.gray(`   3. Check app: curl http://localhost:3000/hu-apigw/appstore/api/v1/app/details?app_id=${appId}`));
    
    console.log('\n' + chalk.cyan('🔧 Files Created:'));
    console.log(chalk.gray(`   ✅ ${path.join(folderName, 'metadata.json')}`));
    if (apkInfo) {
      console.log(chalk.gray(`   ✅ ${path.join(folderName, 'releases', appData.version, 'info.json')}`));
      console.log(chalk.gray(`   ✅ ${path.join(folderName, 'releases', appData.version, 'app.apk')}`));
    }
    if (appData.iconFile) {
      console.log(chalk.gray(`   ✅ ${path.join(folderName, 'icon.png')}`));
    }
    console.log(chalk.gray(`   ✅ Static files copied to /static`));
    
  } catch (error) {
    console.log('\n' + chalk.red('❌ Error creating app:'));
    console.log(chalk.red(error.message));
    process.exit(1);
  }
}

// Запускаем скрипт
if (require.main === module) {
  addApp();
}

module.exports = { addApp };
