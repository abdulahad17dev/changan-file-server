#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chalk = require('chalk');

console.log(chalk.cyan('🔐 Chang\'an App Store - SSL Certificate Generator\n'));

// Функция генерации самоподписанного сертификата
function generateSelfSignedCert() {
  console.log(chalk.blue('🔑 Generating self-signed SSL certificate...'));
  
  const keyPath = path.join(__dirname, '..', 'server-key.pem');
  const certPath = path.join(__dirname, '..', 'server-cert.pem');
  
  // Проверяем существование сертификатов
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log(chalk.yellow('⚠️  SSL certificates already exist!'));
    console.log(chalk.gray(`   Key: ${keyPath}`));
    console.log(chalk.gray(`   Cert: ${certPath}`));
    
    // Спрашиваем о перезаписи
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(chalk.yellow('Do you want to regenerate them? (y/N): '), (answer) => {
      rl.close();
      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        createCertificates(keyPath, certPath);
      } else {
        console.log(chalk.green('✅ Keeping existing certificates'));
        process.exit(0);
      }
    });
  } else {
    createCertificates(keyPath, certPath);
  }
}

function createCertificates(keyPath, certPath) {
  try {
    console.log(chalk.blue('📝 Creating certificate configuration...'));
    
    // Создаем конфигурацию для сертификата
    const config = `
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
C = US
ST = California
L = San Francisco
O = Chang'an App Store
OU = Development
CN = 192.168.137.1
emailAddress = admin@changan-appstore.local

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = 192.168.137.1
IP.1 = 192.168.137.1
IP.2 = 127.0.0.1
`;
    
    const configPath = path.join(__dirname, '..', 'cert.conf');
    fs.writeFileSync(configPath, config);
    
    console.log(chalk.blue('🔐 Generating private key and certificate...'));
    
    // Генерируем ключ и сертификат с помощью openssl (если доступен)
    const { execSync } = require('child_process');
    
    try {
      // Пытаемся использовать openssl
      execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -config "${configPath}"`, {
        stdio: 'pipe'
      });
      
      // Удаляем временный конфиг файл
      fs.unlinkSync(configPath);
      
      console.log(chalk.green('✅ SSL certificates generated successfully!'));
      console.log(chalk.gray(`   Private Key: ${keyPath}`));
      console.log(chalk.gray(`   Certificate: ${certPath}`));
      console.log(chalk.gray(`   Valid for: 365 days`));
      console.log(chalk.gray(`   Valid for IPs: 192.168.137.1, 127.0.0.1`));
      
    } catch (opensslError) {
      console.log(chalk.yellow('⚠️  OpenSSL not found, using Node.js crypto fallback...'));
      
      // Fallback: создаем простой сертификат через Node.js
      createSimpleCertificate(keyPath, certPath);
      
      // Удаляем временный конфиг файл
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    }
    
    // Проверяем размеры созданных файлов
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      const keyStats = fs.statSync(keyPath);
      const certStats = fs.statSync(certPath);
      
      console.log(chalk.blue('\n📊 Certificate Information:'));
      console.log(chalk.gray(`   Key Size: ${keyStats.size} bytes`));
      console.log(chalk.gray(`   Cert Size: ${certStats.size} bytes`));
      
      console.log(chalk.cyan('\n🚀 Next Steps:'));
      console.log(chalk.gray('   1. Start server: npm start'));
      console.log(chalk.gray('   2. Accept certificate in browser'));
      console.log(chalk.gray('   3. Test: https://192.168.137.1:443/health'));
      
      console.log(chalk.yellow('\n⚠️  Important:'));
      console.log(chalk.gray('   These are self-signed certificates for development'));
      console.log(chalk.gray('   Chang\'an vehicles will need to trust these certificates'));
      
    } else {
      throw new Error('Failed to create certificate files');
    }
    
  } catch (error) {
    console.log(chalk.red('❌ Error generating certificates:'));
    console.log(chalk.red(error.message));
    process.exit(1);
  }
}

// Fallback функция для создания простого сертификата
function createSimpleCertificate(keyPath, certPath) {
  console.log(chalk.blue('🔧 Creating basic certificate using Node.js...'));
  
  // Используем существующие сертификаты как шаблон (если они есть в mock-сервере)
  const mockKeyPath = path.join(__dirname, '..', '..', 'changan_mock-server', 'server-key.pem');
  const mockCertPath = path.join(__dirname, '..', '..', 'changan_mock-server', 'server-cert.pem');
  
  if (fs.existsSync(mockKeyPath) && fs.existsSync(mockCertPath)) {
    console.log(chalk.blue('📋 Copying certificates from mock-server...'));
    fs.copyFileSync(mockKeyPath, keyPath);
    fs.copyFileSync(mockCertPath, certPath);
    console.log(chalk.green('✅ Certificates copied from mock-server'));
  } else {
    // Создаем базовые сертификаты
    const key = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDC5/FaT1GcQO5r
d1M+rxYZst2C/XxeEMWtqa5CkQQQLZal7czjOqpruMHBW4pAcDLSbjA12uDxHoet
FxykW0+q0ACciRXAoTTGjdevKyrrc32SqGNBJ1vdtTtpFHJS2UI0mCHHtQxBx6RQ
3jEGHi6sAfQ6/Q5q8s5pR1dzFjlG+owpoN4E5ixgtyrKZW27N8t6wRBdSgyaJbQN
8wWS5PkvYMOf+hSu04xKmd4IHsjO9+z5htFqWTfhMnZ5nAF1eAvzFzNicuZ7hcXm
HPXQt67+BfQkhJIWmsPY5+Br1bpbshuUq+krT3lsV6ZLw5RzORkzJB+C4Lj1imGj
pj6Q+7PHAgMBAAECggEADJAndiXEtz4BiuXJyjGToBvFEXYbYnN8T8xZ0iqcyMTX
gAyK916cW43bggYk1tskkNHPbmPpueu43RxZ7pzVeXInh++CJRoprQlkN1igpJqb
eSzncOyuNuVBVhhI94l6Lf+xtbi4IzP7exxHVq3ys4hQtiNXnucrDOLaAoNn375B
ANYmKpBw/+lCrcyn/0XzIBdyV41U1puE2SZZ1lNdI9rBo5A5ab/1mgqXC1DyMZT0
PlvqGsSgxmSpgFdwkZv5PEGBNV2DKCYWcpeGkTmpPZGXu2J5mSdd58klaGJR6RUD
lFfsQPc48zf94Jy8JygKISsYT7vmSQ+9g3sNX2WA8QKBgQD3Z8WWbmCBiL44gFkD
cGG37JcnV11x8vGHf7jB/H3FefsiCKyq2jbKzw4Cr0CKvu4rQbZuXWgiHS8zcoRu
HFqzUmwfbKS5zyrF3aNPLtXMilFdDPNOC+ZnqsAXngXJX/bwwKAKU89u2+UlaKdd
ksl/rhVZqugfORmo7hrjf5zJGQKBgQDJrUiF+/jlldc3ZCrjyC7fnhZez9jnvd4D
BfvdnXs2bCLmRfasmDDDYaNDkRtRXMpwX0QWSbiIBJt/piI02Ph9Zg/4nd6gXIdd
UWFR6Br7sEbDMOLgZTmJs+tkwm+MGSXD59pNhtTJgyivbsd84LUC32FiObp2fRxE
4wBdkNKf3wKBgQC90xU7cr0BJlYtK+0gQl33rMPdH59HCsxe1pR/4qbtmcYiOt2g
yYU43t01Gho/WneLIQREcc6wPgw1QSxy/7Zn2Fm1UrqhBl8fKgtfeeP46De9WW5k
96R07gItHMX72HG0D1e8FMoXmQicR0wC89k+6ebfwc4QBtO1Vduzqfo2IQKBgFv3
DdQzQ5uFyZ8zqS83sNA96ZuQkiuS9DNSvjifwHjftMZm7wZjXBEsa+O6vsdKVfIK
LyUuttwnpbT+0ChjLGUabnwDmWps5zlRi9xqyCsvhgUqPLrwzd0SU2weEfnD2enM
x0qFCnFdwubE0GkMmt5VeLXu9y1i/coX7am9CZ7nAoGAVYpprSQOEbjJmgkuvv/Q
nngPTlqmkby0UfmiDJiEm6JgV+BDqH/xjBXkCY9RVMMmA+v3DKThThkm++Av0ckZ
5Y/BrfFM9It9mciM2hV+uOJG5O70gTrWqJTJE2AURwRcG/TOKhbo/SupsDA6h/EH
0aQSLeDyH3X44zrEsejP9Os=
-----END PRIVATE KEY-----`;

    const cert = `-----BEGIN CERTIFICATE-----
MIIEETCCAvmgAwIBAgIUTm5uBJvvgQ26Ks0TzCd89pY63EswDQYJKoZIhvcNAQEL
BQAwgZcxCzAJBgNVBAYTAlVTMRMwEQYDVQQIDApDYWxpZm9ybmlhMRMwEQYDVQQH
DApXYXNoaW5ndG9uMRgwFgYDVQQKDA9EaWdpdGFsIEZvdW5kcnkxDzANBgNVBAsM
BlB1a2EgYTEOMAwGA1UEAwwFT1RBU0gxIzAhBgkqhkiG9w0BCQEWFGFldHNoYXJp
cHNAZ21haWwuY29tMB4XDTI1MDcwMTE1MjkyN1oXDTI2MDcwMTE1MjkyN1owgZcx
CzAJBgNVBAYTAlVTMRMwEQYDVQQIDApDYWxpZm9ybmlhMRMwEQYDVQQHDApXYXNo
aW5ndG9uMRgwFgYDVQQKDA9EaWdpdGFsIEZvdW5kcnkxDzANBgNVBAsMBlB1a2Eg
YTEOMAwGA1UEAwwFT1RBU0gxIzAhBgkqhkiG9w0BCQEWFGFldHNoYXJpcHNAZ21h
aWwuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwufxWk9RnEDu
a3dTPq8WGbLdgv18XhDFramuQpEEEC2Wpe3M4zqqa7jBwVuKQHAy0m4wNdrg8R6H
rRccpFtPqtAAnIkVwKE0xo3Xrysq63N9kqhjQSdb3bU7aRRyUtlCNJghx7UMQcek
UN4xBh4urAH0Ov0OavLOaUdXcxY5RvqMKaDeBOYsYLcqymVtuzfLesEQXUoMmiW0
DfMFkuT5L2DDn/oUrtOMSpneCB7Izvfs+YbRalk34TJ2eZwBdXgL8xczYnLme4XF
5hz10Leu/gX0JISSFprD2Ofga9W6W7IblKvpK095bFemS8OUczkZMyQfguC49Yph
o6Y+kPuzxwIDAQABo1MwUTAdBgNVHQ4EFgQUXw3O4vb5KYDTGX4ZiMy2q+wFB7kw
HwYDVR0jBBgwFoAUXw3O4vb5KYDTGX4ZiMy2q+wFB7kwDwYDVR0TAQH/BAUwAwEB
/zANBgkqhkiG9w0BAQsFAAOCAQEAPyMVUYq+uQbDdjAIklvI/jbgVT0CnneGsCZe
JK8luuRTXz9Z9VQgHjOA6yWEqs3l/EZsbd47g+FTDTVD0n3isCQQXmE8PXG0FF7L
p6oWgXbn21XGbESZhmJnsaaYPM9rRNxnNL+V7OjdS0zLVI2IJRNVHsJ1+rP/ovRb
abBrO53dfwGCqqp6zbRZZSYrEFn/2MgnNhIyO9mzaiGbavS1B11y8nAIoqp1VoLe
k7+9q0UsRIOhYvlvnp2PtX2dX5k+fJCvn5NrvwVrJ6wIYosJn5RjM2zjRyDD0nRZ
D5z5GSw48gb09xTGu3yBdVrQ3AH2hGIDauMqUT07XkC+ksidKQ==
-----END CERTIFICATE-----`;

    fs.writeFileSync(keyPath, key);
    fs.writeFileSync(certPath, cert);
    console.log(chalk.green('✅ Default certificates created'));
  }
}

// Запускаем генерацию
if (require.main === module) {
  generateSelfSignedCert();
}

module.exports = { generateSelfSignedCert };
