#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chalk = require('chalk');

console.log(chalk.cyan('🔍 Chang\'an App Store - App Validator\n'));

// Путь к папке приложений
const APPS_STORE_PATH = path.join(__dirname, '..', 'apps', 'store');
const STATIC_PATH = path.join(__dirname, '..', 'static');

// Статистика валидации
let stats = {
  totalApps: 0,
  validApps: 0,
  invalidApps: 0,
  warnings: 0,
  errors: 0
};

// Функция валидации одного приложения
function validateApp(appFolder) {
  const appPath = path.join(APPS_STORE_PATH, appFolder);
  const results = {
    appFolder,
    isValid: true,
    errors: [],
    warnings: [],
    info: {}
  };
  
  console.log(chalk.blue(`📱 Validating: ${appFolder}`));
  
  try {
    // 1. Проверяем metadata.json
    const metadataPath = path.join(appPath, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      results.errors.push('metadata.json not found');
      results.isValid = false;
    } else {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        results.info.metadata = metadata;
        
        // Проверяем обязательные поля
        const requiredFields = ['app_id', 'name', 'package_name'];
        for (const field of requiredFields) {
          if (!metadata[field]) {
            results.errors.push(`Missing required field in metadata.json: ${field}`);
            results.isValid = false;
          }
        }
        
        // Проверяем формат app_id
        if (metadata.app_id && !/^[a-zA-Z0-9-_]+$/.test(metadata.app_id)) {
          results.warnings.push('app_id contains special characters');
        }
        
        console.log(chalk.gray(`   Name: ${metadata.name}`));
        console.log(chalk.gray(`   Package: ${metadata.package_name}`));
        console.log(chalk.gray(`   App ID: ${metadata.app_id}`));
        
      } catch (error) {
        results.errors.push(`Invalid JSON in metadata.json: ${error.message}`);
        results.isValid = false;
      }
    }
    
    // 2. Проверяем иконку
    const iconPath = path.join(appPath, 'icon.png');
    const staticIconPath = path.join(STATIC_PATH, 'icons', appFolder, 'icon.png');
    
    if (!fs.existsSync(iconPath)) {
      results.warnings.push('icon.png not found in app folder');
    } else {
      const iconStats = fs.statSync(iconPath);
      results.info.iconSize = iconStats.size;
      console.log(chalk.gray(`   Icon: ${iconStats.size} bytes`));
    }
    
    if (!fs.existsSync(staticIconPath)) {
      results.warnings.push('icon.png not found in static folder');
    }
    
    // 3. Проверяем releases
    const releasesPath = path.join(appPath, 'releases');
    if (!fs.existsSync(releasesPath)) {
      results.errors.push('releases folder not found');
      results.isValid = false;
    } else {
      const versions = fs.readdirSync(releasesPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      if (versions.length === 0) {
        results.warnings.push('No version folders found in releases');
      } else {
        console.log(chalk.gray(`   Versions: ${versions.join(', ')}`));
        results.info.versions = versions;
        
        // Проверяем последнюю версию
        const latestVersion = versions.sort((a, b) => b.localeCompare(a))[0];
        const versionPath = path.join(releasesPath, latestVersion);
        
        // Проверяем info.json
        const infoJsonPath = path.join(versionPath, 'info.json');
        if (!fs.existsSync(infoJsonPath)) {
          results.errors.push(`info.json not found for version ${latestVersion}`);
          results.isValid = false;
        } else {
          try {
            const versionInfo = JSON.parse(fs.readFileSync(infoJsonPath, 'utf8'));
            results.info.versionInfo = versionInfo;
            
            // Проверяем APK файл
            const apkPath = path.join(versionPath, versionInfo.apk_filename || 'app.apk');
            const staticApkPath = path.join(STATIC_PATH, 'apks', appFolder, latestVersion, versionInfo.apk_filename || 'app.apk');
            
            if (!fs.existsSync(apkPath)) {
              results.errors.push(`APK file not found: ${versionInfo.apk_filename || 'app.apk'}`);
              results.isValid = false;
            } else {
              const apkStats = fs.statSync(apkPath);
              results.info.apkSize = apkStats.size;
              console.log(chalk.gray(`   APK: ${apkStats.size} bytes`));
              
              // Проверяем размер файла
              if (versionInfo.file_size && parseInt(versionInfo.file_size) !== apkStats.size) {
                results.warnings.push(`APK file size mismatch: expected ${versionInfo.file_size}, got ${apkStats.size}`);
              }
              
              // Проверяем хеш
              if (versionInfo.hash_code) {
                const actualHash = crypto.createHash('md5').update(fs.readFileSync(apkPath)).digest('hex');
                if (actualHash !== versionInfo.hash_code) {
                  results.warnings.push(`APK hash mismatch: expected ${versionInfo.hash_code}, got ${actualHash}`);
                }
              }
            }
            
            if (!fs.existsSync(staticApkPath)) {
              results.warnings.push('APK not found in static folder');
            }
            
          } catch (error) {
            results.errors.push(`Invalid JSON in info.json: ${error.message}`);
            results.isValid = false;
          }
        }
      }
    }
    
    // 4. Проверяем папку screenshots
    const screenshotsPath = path.join(appPath, 'screenshots');
    if (fs.existsSync(screenshotsPath)) {
      const screenshots = fs.readdirSync(screenshotsPath)
        .filter(file => /\.(png|jpg|jpeg)$/i.test(file));
      results.info.screenshots = screenshots.length;
      console.log(chalk.gray(`   Screenshots: ${screenshots.length}`));
    } else {
      results.warnings.push('screenshots folder not found');
    }
    
  } catch (error) {
    results.errors.push(`Validation error: ${error.message}`);
    results.isValid = false;
  }
  
  return results;
}

// Функция отображения результатов
function displayResults(results) {
  if (results.isValid) {
    console.log(chalk.green('   ✅ Valid\n'));
    stats.validApps++;
  } else {
    console.log(chalk.red('   ❌ Invalid\n'));
    stats.invalidApps++;
  }
  
  if (results.errors.length > 0) {
    console.log(chalk.red('   Errors:'));
    results.errors.forEach(error => {
      console.log(chalk.red(`     • ${error}`));
      stats.errors++;
    });
  }
  
  if (results.warnings.length > 0) {
    console.log(chalk.yellow('   Warnings:'));
    results.warnings.forEach(warning => {
      console.log(chalk.yellow(`     • ${warning}`));
      stats.warnings++;
    });
  }
  
  console.log('');
}

// Основная функция валидации
function validateAllApps() {
  console.log(chalk.blue(`🔍 Scanning apps directory: ${APPS_STORE_PATH}\n`));
  
  if (!fs.existsSync(APPS_STORE_PATH)) {
    console.log(chalk.red('❌ Apps store directory not found!'));
    console.log(chalk.gray(`Expected: ${APPS_STORE_PATH}`));
    process.exit(1);
  }
  
  const appFolders = fs.readdirSync(APPS_STORE_PATH, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  if (appFolders.length === 0) {
    console.log(chalk.yellow('⚠️  No app folders found in store directory'));
    console.log(chalk.gray('Add apps using: npm run add-app -- --name "App Name"'));
    return;
  }
  
  stats.totalApps = appFolders.length;
  console.log(chalk.blue(`📱 Found ${appFolders.length} app(s) to validate:\n`));
  
  const allResults = [];
  
  for (const appFolder of appFolders) {
    const results = validateApp(appFolder);
    displayResults(results);
    allResults.push(results);
  }
  
  // Итоговая статистика
  console.log(chalk.cyan('📊 Validation Summary:'));
  console.log(chalk.gray(`   Total Apps: ${stats.totalApps}`));
  console.log(stats.validApps > 0 ? chalk.green(`   Valid Apps: ${stats.validApps}`) : chalk.gray(`   Valid Apps: ${stats.validApps}`));
  console.log(stats.invalidApps > 0 ? chalk.red(`   Invalid Apps: ${stats.invalidApps}`) : chalk.gray(`   Invalid Apps: ${stats.invalidApps}`));
  console.log(stats.warnings > 0 ? chalk.yellow(`   Warnings: ${stats.warnings}`) : chalk.gray(`   Warnings: ${stats.warnings}`));
  console.log(stats.errors > 0 ? chalk.red(`   Errors: ${stats.errors}`) : chalk.gray(`   Errors: ${stats.errors}`));
  
  if (stats.invalidApps === 0 && stats.errors === 0) {
    console.log('\n' + chalk.green('🎉 All apps are valid!'));
  } else if (stats.errors > 0) {
    console.log('\n' + chalk.red('❌ Some apps have errors that need to be fixed'));
    process.exit(1);
  } else {
    console.log('\n' + chalk.yellow('⚠️  All apps are valid but have warnings'));
  }
}

// Запускаем валидацию
if (require.main === module) {
  validateAllApps();
}

module.exports = { validateAllApps, validateApp };
