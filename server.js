const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// Загружаем конфигурацию
const serverConfig = JSON.parse(fs.readFileSync('./apps/config/server-config.json', 'utf8'));
const categories = JSON.parse(fs.readFileSync('./apps/config/categories.json', 'utf8'));

// Настройки из конфигурации
const PORT = process.env.NODE_ENV === 'development' ? serverConfig.server.dev_port : serverConfig.server.port;
const HOST = process.env.NODE_ENV === 'development' ? serverConfig.server.dev_host : serverConfig.server.host;
const IS_DEV = process.env.NODE_ENV === 'development';

console.log(`🚗 Starting Chang'an File Server...`);
console.log(`📍 Mode: ${IS_DEV ? 'Development' : 'Production'}`);
console.log(`🌐 Will run on: ${IS_DEV ? 'http' : 'https'}://${HOST}:${PORT}`);

// Глобальное хранилище приложений (будет заполнено AppScanner'ом)
let appsCache = new Map();
let lastScanTime = null;

// Middleware настройки
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статические файлы
app.use('/static', express.static(path.join(__dirname, 'static')));

// Middleware for logging ALL requests (enhanced debugging)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} - ${req.method} ${req.url}`);
  console.log(`🌐 Host header: ${req.headers.host}`);
  console.log(`🔗 User-Agent: ${req.headers['user-agent']}`);
  
  if (serverConfig.logging.log_requests) {
    console.log('Headers:', JSON.stringify({
      'X-VCS-Hu-Token': req.headers['x-vcs-hu-token'],
      'X-VCS-Timestamp': req.headers['x-vcs-timestamp'],
      'X-VCS-Nonce': req.headers['x-vcs-nonce']
    }, null, 2));
    
    if (req.query && Object.keys(req.query).length > 0) {
      console.log('Query:', JSON.stringify(req.query, null, 2));
    }
    
    if (req.body && Object.keys(req.body).length > 0) {
      console.log('Body:', JSON.stringify(req.body, null, 2));
    }
    console.log('---');
  }
  
  next();
});

// Middleware для Chang'An API аутентификации (bypass в dev режиме)
app.use('/hu-apigw/*', (req, res, next) => {
  if (IS_DEV) {
    console.log('🔓 Chang\'An API request - authentication bypassed (dev mode)');
  } else {
    console.log('🔐 Chang\'An API request - authentication bypassed (mock mode)');
  }
  next();
});

// Простой AppScanner для сканирования apps/store/
class AppScanner {
  constructor(appsPath) {
    this.appsPath = appsPath;
    this.appsCache = new Map();
  }

  async scanApps() {
    console.log('📁 Scanning apps directory...');
    const storePath = path.join(this.appsPath, 'store');
    
    if (!fs.existsSync(storePath)) {
      console.log('⚠️  Store directory not found, creating...');
      fs.mkdirSync(storePath, { recursive: true });
      return;
    }

    const appFolders = fs.readdirSync(storePath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    console.log(`📱 Found ${appFolders.length} app folders`);

    for (const appFolder of appFolders) {
      try {
        const appPath = path.join(storePath, appFolder);
        const metadataPath = path.join(appPath, 'metadata.json');
        
        if (fs.existsSync(metadataPath)) {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          
          // Получаем информацию о последней версии
          const releasesPath = path.join(appPath, 'releases');
          let latestVersion = null;
          
          if (fs.existsSync(releasesPath)) {
            const versions = fs.readdirSync(releasesPath, { withFileTypes: true })
              .filter(dirent => dirent.isDirectory())
              .map(dirent => dirent.name)
              .sort((a, b) => b.localeCompare(a)); // Сортируем по убыванию
            
            if (versions.length > 0) {
              const versionPath = path.join(releasesPath, versions[0], 'info.json');
              if (fs.existsSync(versionPath)) {
                latestVersion = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
              }
            }
          }
          
          // Комбинируем метаданные с информацией о версии
          const appData = {
            ...metadata,
            version_info: latestVersion,
            folder_name: appFolder,
            last_scanned: new Date().toISOString()
          };
          
          this.appsCache.set(metadata.app_id, appData);
          console.log(`✅ Loaded app: ${metadata.name} (${metadata.app_id})`);
        } else {
          console.log(`⚠️  No metadata.json found for app: ${appFolder}`);
        }
      } catch (error) {
        console.error(`❌ Error loading app ${appFolder}:`, error.message);
      }
    }
    
    console.log(`📊 Total apps loaded: ${this.appsCache.size}`);
    lastScanTime = new Date().toISOString();
  }

  getAppList(filters = {}) {
    const apps = Array.from(this.appsCache.values());
    
    // Применяем фильтры
    let filteredApps = apps;
    
    if (filters.search_content) {
      filteredApps = apps.filter(app => 
        app.name.toLowerCase().includes(filters.search_content.toLowerCase()) ||
        app.package_name.toLowerCase().includes(filters.search_content.toLowerCase())
      );
    }
    
    if (filters.type) {
      filteredApps = filteredApps.filter(app => app.type === filters.type);
    }
    
    return filteredApps;
  }

  getAppById(appId) {
    return this.appsCache.get(appId);
  }
}

// Инициализируем сканер
const scanner = new AppScanner('./apps');

// =============================================================================
// CHANG'AN VCS API ENDPOINTS
// =============================================================================

// 1. App List Endpoint - Список приложений с пагинацией
app.get('/hu-apigw/appstore/api/v1/app/list', (req, res) => {
  const currentPage = parseInt(req.query.current_page) || 1;
  const pageSize = Math.min(parseInt(req.query.page_size) || 10, serverConfig.pagination.max_page_size);
  const searchContent = req.query.search_content || '';
  const type = req.query.type || '';

  console.log(`📱 App list requested - Page: ${currentPage}, Size: ${pageSize}, Search: "${searchContent}", Type: "${type}"`);

  // Получаем отфильтрованные приложения
  const filteredApps = scanner.getAppList({ 
    search_content: searchContent,
    type: type 
  });

  // Применяем пагинацию
  const total = filteredApps.length;
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedApps = filteredApps.slice(startIndex, endIndex);

  // Преобразуем в формат Chang'an
  const formattedApps = paginatedApps.map(app => formatAppForList(app));

  const response = {
    code: 0,
    data: {
      list: formattedApps,
      pagination: {
        current: currentPage,
        pageSize: pageSize,
        total: total
      }
    },
    msg: "",
    success: true
  };

  console.log(`📊 Returning ${paginatedApps.length} apps out of ${total} total`);
  res.json(response);
});

// 2. App Details Endpoint - Детали конкретного приложения
app.get('/hu-apigw/appstore/api/v1/app/details', (req, res) => {
  const appId = req.query.app_id;
  const packageName = req.query.package_name;

  console.log(`📖 App details requested - App ID: ${appId}, Package: ${packageName}`);

  if (!appId) {
    return res.status(400).json({
      code: 40005,
      data: null,
      msg: "app_id parameter is required",
      success: false
    });
  }

  const app = scanner.getAppById(appId);
  if (!app) {
    console.log(`❌ App not found: ${appId}`);
    return res.status(404).json({
      code: 40404,
      data: null,
      msg: "App not found",
      success: false
    });
  }

  const detailedApp = formatAppForDetails(app);

  const response = {
    code: 0,
    data: detailedApp,
    msg: "",
    success: true
  };

  console.log(`✅ Returning details for app: ${app.name}`);
  res.json(response);
});

// 3. App Categories/Types Endpoint - Категории приложений
app.get('/hu-apigw/appstore/api/v1/app/query', (req, res) => {
  const dictName = req.query.dictName;
  
  console.log(`📋 App query requested - dictName: ${dictName}`);

  if (dictName === 'app_type') {
    const response = {
      code: 0,
      data: categories.categories.map(cat => ({
        dictLabel: cat.dictLabel,
        dictValue: cat.dictValue
      })),
      msg: "",
      success: true
    };
    console.log(`✅ Returning ${categories.categories.length} categories`);
    res.json(response);
  } else {
    res.status(400).json({
      code: 40005,
      data: null,
      msg: "Invalid dictName parameter",
      success: false
    });
  }
});

// =============================================================================
// INSTALLATION ENDPOINTS - Handle post-download installation phase
// =============================================================================

// 16. Installation Verification Endpoint - Verify Downloaded File
app.post('/hu-apigw/appstore/api/v1/task/verify-file', (req, res) => {
  const { task_id, file_hash, file_size } = req.body;
  
  console.log(`🔍 File verification requested - Task: ${task_id}`);
  
  const response = {
    code: 0,
    data: {
      task_id: task_id,
      verification_status: 'verified',
      file_integrity: 'ok',
      hash_match: true,
      ready_for_installation: true
    },
    msg: "",
    success: true
  };
  
  console.log(`✅ File verification successful - ready for installation`);
  res.json(response);
});

// 17. Installation Start Endpoint - Begin Installation Process  
app.post('/hu-apigw/appstore/api/v1/task/start-install', (req, res) => {
  const { task_id, package_name, app_id } = req.body;
  
  console.log(`📱 Installation start requested - Task: ${task_id}, Package: ${package_name}`);
  
  // Generate installation task ID
  const installTaskId = `INSTALL_${Date.now()}_${task_id?.slice(-8) || 'UNKNOWN'}`;
  
  const response = {
    code: 0,
    data: {
      original_task_id: task_id,
      install_task_id: installTaskId,
      install_status: 'installing',
      progress: 0,
      estimated_time: 30 // seconds
    },
    msg: "",
    success: true
  };
  
  console.log(`📦 Installation started - Install Task ID: ${installTaskId}`);
  res.json(response);
});

// 18. Installation Progress Endpoint - Track Installation Progress
app.post('/hu-apigw/appstore/api/v1/task/update-install-process', (req, res) => {
  const { install_task_id, progress, status } = req.body;
  
  console.log(`📊 Installation progress update - Task: ${install_task_id}, Progress: ${progress}%`);
  
  const response = {
    code: 0,
    data: {
      install_task_id: install_task_id,
      install_progress: progress || 0,
      install_status: status || 'installing',
      completion_estimated: progress >= 90
    },
    msg: "",
    success: true
  };
  
  console.log(`✅ Installation progress: ${progress}%`);
  res.json(response);
});

// 19. Installation Complete Endpoint - Complete Installation
app.post('/hu-apigw/appstore/api/v1/task/complete-install', (req, res) => {
  const { install_task_id, original_task_id, status, package_name } = req.body;
  
  console.log(`🏆 Installation completion - Task: ${install_task_id}, Status: ${status}`);
  
  // Update installation logs
  try {
    const tasksData = JSON.parse(fs.readFileSync('./apps/logs/tasks.json', 'utf8'));
    const taskIndex = tasksData.tasks.findIndex(task => task.task_id === original_task_id);
    
    if (taskIndex !== -1) {
      tasksData.tasks[taskIndex].install_status = status || 'installed';
      tasksData.tasks[taskIndex].install_completed_at = new Date().toISOString();
      tasksData.tasks[taskIndex].install_task_id = install_task_id;
      
      fs.writeFileSync('./apps/logs/tasks.json', JSON.stringify(tasksData, null, 2));
      console.log(`📈 Installation completed for package: ${package_name}`);
    }
  } catch (error) {
    console.error('Error updating installation status:', error.message);
  }
  
  const response = {
    code: 0,
    data: {
      install_task_id: install_task_id,
      original_task_id: original_task_id,
      final_status: status || 'installed',
      completion_time: new Date().toISOString(),
      app_ready: true,
      launch_available: true
    },
    msg: "",
    success: true
  };
  
  console.log(`🎉 📦 Installation completed successfully!`);
  console.log(`🚀 App is ready to launch: ${package_name}`);
  res.json(response);
});

// 4. Initial Parameters Endpoint - Параметры для загрузки
app.get('/hu-apigw/appstore/api/v1/task/initial-params', (req, res) => {
  console.log('⚙️ Initial params requested');
  
  const response = {
    code: 0,
    data: {
      max_concurrent_downloads: serverConfig.download.max_concurrent_downloads,
      retry_attempts: serverConfig.download.retry_attempts,
      timeout_seconds: serverConfig.download.timeout_seconds,
      server_time: Date.now()
    },
    msg: "",
    success: true
  };
  
  console.log('✅ Returning server configuration');
  res.json(response);
});

// 5. HuTags Endpoint - Proxy to incall.changan.com.cn
app.post('/hu-apigw/evhu/api/push/getHuTags', (req, res) => {
  const registrationId = req.body.registrationId;
  
  console.log(`🏷️ HuTags requested - Registration ID: ${registrationId}`);
  console.log('🔄 Proxying request to incall.changan.com.cn');
  console.log('⚠️  SSL certificate verification disabled for upstream server');
  
  // Check if client is still connected
  if (req.destroyed || res.destroyed) {
    console.log('❌ Client already disconnected, aborting request');
    return;
  }
  
  // Prepare headers for the upstream request
  const upstreamHeaders = { ...req.headers };
  
  // Remove headers that shouldn't be forwarded
  delete upstreamHeaders.host;
  delete upstreamHeaders['content-length']; // Will be recalculated
  
  // Set the correct host for upstream
  upstreamHeaders.host = 'incall.changan.com.cn';
  
  // Convert request body to string if it's an object
  const requestBody = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
  
  // Configure the upstream request
  const options = {
    hostname: 'incall.changan.com.cn',
    port: 443,
    path: '/hu-apigw/evhu/api/push/getHuTags',
    method: 'POST',
    headers: {
      ...upstreamHeaders,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody)
    },
    timeout: 30000, // 30 seconds timeout
    rejectUnauthorized: false // Ignore self-signed certificate errors
  };
  
  console.log(`📤 Forwarding to: https://${options.hostname}${options.path}`);
  
  let upstreamReq;
  let requestCompleted = false;
  
  // Function to cleanup and abort upstream request
  const cleanupUpstreamRequest = () => {
    if (upstreamReq && !requestCompleted) {
      console.log('🧹 Cleaning up upstream request due to client disconnect');
      requestCompleted = true;
      upstreamReq.destroy();
    }
  };
  
  // Listen for client disconnect
  req.on('close', () => {
    console.log('📴 Client disconnected, aborting upstream request');
    cleanupUpstreamRequest();
  });
  
  req.on('aborted', () => {
    console.log('🚫 Request aborted, aborting upstream request');
    cleanupUpstreamRequest();
  });
  
  res.on('close', () => {
    console.log('📴 Response stream closed, aborting upstream request');
    cleanupUpstreamRequest();
  });
  
  // Make the upstream request
  upstreamReq = https.request(options, (upstreamRes) => {
    // Check if client is still connected before processing response
    if (requestCompleted || req.destroyed || res.destroyed) {
      console.log('❌ Client disconnected during upstream response, aborting');
      upstreamRes.destroy();
      return;
    }
    
    console.log(`📥 Received response from upstream: ${upstreamRes.statusCode}`);
    
    let responseData = '';
    
    // Collect response data
    upstreamRes.on('data', (chunk) => {
      if (requestCompleted || req.destroyed || res.destroyed) {
        console.log('❌ Client disconnected during data reception, stopping');
        upstreamRes.destroy();
        return;
      }
      responseData += chunk;
    });
    
    // Handle response completion
    upstreamRes.on('end', () => {
      if (requestCompleted || req.destroyed || res.destroyed) {
        console.log('❌ Client disconnected before response completion, aborting');
        return;
      }
      
      requestCompleted = true;
      console.log('✅ Upstream response received successfully');
      
      try {
        // Forward the response status and headers
        res.status(upstreamRes.statusCode);
        
        // Forward relevant headers (excluding some that might cause issues)
        Object.keys(upstreamRes.headers).forEach(key => {
          if (!['connection', 'transfer-encoding', 'content-encoding'].includes(key.toLowerCase())) {
            res.set(key, upstreamRes.headers[key]);
          }
        });
        
        // Try to parse as JSON, otherwise send as text
        try {
          const jsonResponse = JSON.parse(responseData);
          console.log('📋 Response type: JSON');
          res.json(jsonResponse);
        } catch (jsonError) {
          console.log('📋 Response type: Text/Other');
          res.send(responseData);
        }
      } catch (error) {
        console.error('❌ Error processing upstream response:', error.message);
        if (!res.headersSent) {
          res.status(500).json({
            code: 50000,
            data: null,
            msg: "Error processing upstream response",
            success: false
          });
        }
      }
    });
    
    // Handle upstream response errors
    upstreamRes.on('error', (error) => {
      if (requestCompleted) return;
      requestCompleted = true;
      console.error('❌ Error in upstream response:', error.message);
      
      if (!res.headersSent) {
        res.status(502).json({
          code: 50200,
          data: null,
          msg: `Upstream response error: ${error.message}`,
          success: false
        });
      }
    });
  });
  
  // Handle upstream request errors
  upstreamReq.on('error', (error) => {
    if (requestCompleted) return;
    requestCompleted = true;
    console.error('❌ Error connecting to upstream server:', error.message);
    
    if (!res.headersSent) {
      res.status(502).json({
        code: 50200,
        data: null,
        msg: `Upstream server error: ${error.message}`,
        success: false
      });
    }
  });
  
  // Handle timeout
  upstreamReq.on('timeout', () => {
    if (requestCompleted) return;
    requestCompleted = true;
    console.error('❌ Upstream request timeout');
    upstreamReq.destroy();
    
    if (!res.headersSent) {
      res.status(504).json({
        code: 50400,
        data: null,
        msg: "Upstream server timeout",
        success: false
      });
    }
  });
  
  // Send the request body
  try {
    upstreamReq.write(requestBody);
    upstreamReq.end();
  } catch (error) {
    if (!requestCompleted) {
      requestCompleted = true;
      console.error('❌ Error sending request to upstream:', error.message);
      
      if (!res.headersSent) {
        res.status(502).json({
          code: 50200,
          data: null,
          msg: `Error sending request to upstream: ${error.message}`,
          success: false
        });
      }
    }
  }
});

// 6. Order List Endpoint - История заказов
app.post('/hu-apigw/huservice/api/v1/store/order-list', (req, res) => {
  const currentPage = parseInt(req.query.current_page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const source = req.query.source || 'HU';
  
  console.log(`🛒 Order list requested - Page: ${currentPage}, Size: ${pageSize}, Source: ${source}`);
  
  // Читаем историю загрузок как заказы
  const downloadsData = JSON.parse(fs.readFileSync('./apps/logs/downloads.json', 'utf8'));
  const mockOrders = downloadsData.downloads.slice(0, 5).map((download, index) => ({
    order_id: `ORDER_${String(index + 1).padStart(3, '0')}`,
    app_id: download.app_id || `APP_ID_${index + 1}`,
    app_name: download.app_name || `App ${index + 1}`,
    order_status: "completed",
    order_time: download.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 19),
    amount: 0.0,
    currency: "CNY"
  }));

  const total = mockOrders.length;
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedOrders = mockOrders.slice(startIndex, endIndex);
  
  const response = {
    code: 0,
    data: {
      list: paginatedOrders,
      pagination: {
        current: currentPage,
        pageSize: pageSize,
        total: total
      }
    },
    msg: "",
    success: true
  };
  
  console.log(`✅ Returning ${paginatedOrders.length} orders out of ${total} total`);
  res.json(response);
});

// 7. User Behavior Analytics (/appserver path)
app.post('/appserver/api/hu/2.0/userBehavior', (req, res) => {
  const accessToken = req.body.access_token;
  const timestamp = req.body.timestamp;
  const behaviorDetail = req.body.behavior_detail;
  
  console.log(`📊 User behavior analytics (/appserver) - Token: ${accessToken}`);
  
  // Сохраняем в лог файл
  try {
    const behaviorData = JSON.parse(fs.readFileSync('./apps/logs/user-behavior.json', 'utf8'));
    behaviorData.user_behaviors.push({
      timestamp: new Date().toISOString(),
      access_token: accessToken,
      behavior_detail: behaviorDetail,
      source: 'appserver'
    });
    behaviorData.analytics.total_events++;
    behaviorData.analytics.last_updated = new Date().toISOString();
    
    fs.writeFileSync('./apps/logs/user-behavior.json', JSON.stringify(behaviorData, null, 2));
  } catch (error) {
    console.error('Error saving user behavior:', error.message);
  }
  
  const response = {
    data: null,
    error_msg: null,
    status_code: 0
  };
  
  console.log('✅ User behavior recorded successfully (/appserver)');
  res.json(response);
});

// 8. User Behavior Analytics (/dt path) - Альтернативный эндпоинт
app.post('/dt/api/hu/2.0/userBehavior', (req, res) => {
  const accessToken = req.body.access_token;
  const timestamp = req.body.timestamp;
  const behaviorDetail = req.body.behavior_detail;
  
  console.log(`📊 User behavior analytics (/dt) - Token: ${accessToken}`);
  
  // Парсим behavior codes из вложенной структуры
  try {
    const behaviors = JSON.parse(behaviorDetail);
    if (behaviors && behaviors[0] && behaviors[0].data) {
      const behaviorCodes = behaviors[0].data.map(item => item.behaviorCode);
      console.log(`Behavior codes: ${behaviorCodes.join(', ')}`);
    }
  } catch (e) {
    console.log('Could not parse behavior detail');
  }
  
  // Сохраняем аналогично первому эндпоинту
  try {
    const behaviorData = JSON.parse(fs.readFileSync('./apps/logs/user-behavior.json', 'utf8'));
    behaviorData.user_behaviors.push({
      timestamp: new Date().toISOString(),
      access_token: accessToken,
      behavior_detail: behaviorDetail,
      source: 'dt'
    });
    behaviorData.analytics.total_events++;
    behaviorData.analytics.last_updated = new Date().toISOString();
    
    fs.writeFileSync('./apps/logs/user-behavior.json', JSON.stringify(behaviorData, null, 2));
  } catch (error) {
    console.error('Error saving user behavior:', error.message);
  }
  
  const response = {
    data: null,
    error_msg: null,
    status_code: 0
  };
  
  console.log('✅ User behavior recorded successfully (/dt)');
  res.json(response);
});

// 9. Resource Update Time Endpoint
app.get('/hu-apigw/appstore/api/v1/resource/update-time', (req, res) => {
  const resourceType = req.query.resource_type;
  
  console.log(`📅 Resource update time requested - Type: ${resourceType}`);
  
  if (resourceType === 'PRIVACY_AGREEMENT') {
    const response = {
      code: 0,
      data: "2025-06-06 14:03:31",
      msg: "",
      success: true
    };
    
    console.log('✅ Returning privacy agreement update time');
    res.json(response);
  } else {
    res.status(400).json({
      code: 40005,
      data: null,
      msg: "Invalid resource_type parameter",
      success: false
    });
  }
});

// 10. Purchase List Endpoint
app.get('/hu-apigw/wiki/api/v1/commodity/purchase-list', (req, res) => {
  const tids = req.query.tids;
  
  console.log(`💰 Purchase list requested - TIDs: ${tids}`);
  
  const tidArray = tids ? tids.split(',').filter(id => id.trim()) : [];
  
  const purchaseList = tidArray.map(tid => ({
    "purchase": false,
    "tid": tid.trim()
  }));
  
  const response = {
    code: 0,
    data: purchaseList,
    msg: "",
    success: true
  };
  
  console.log(`✅ Returning purchase status for ${tidArray.length} items`);
  res.json(response);
});

// 11. Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    server: 'Chang\'An File Server',
    version: '1.0.0',
    apps_loaded: appsCache.size,
    last_scan: lastScanTime
  });
});

// =============================================================================
// ФУНКЦИИ ФОРМАТИРОВАНИЯ ДАННЫХ
// =============================================================================

// Форматирование приложения для списка
function formatAppForList(app) {
  const baseUrl = IS_DEV ? `http://${HOST}:${PORT}` : serverConfig.server.base_url;
  const gitUrl = `https://github.com/sumatoshi/dhu-apk-list-2/raw/main`;
  
  return {
    app_id: app.app_id,
    name: app.name,
    package_name: app.package_name,
    icon: `${gitUrl}/${app.folder_name}/png.png`,
    slogan: app.slogan || `${app.name} - отличное приложение`,
    version: app.version_info?.version || "1.0.0",
    version_id: app.version_info?.version_number || "100000",
    version_number: app.version_info?.version_number || 100000,
    type: app.category || "99",
    tid: app.app_id,
    restricted_state: app.restricted_state || 0,
    uninstall: app.uninstall !== undefined ? app.uninstall : true,
    apk_info: {
      apk_name: app.version_info?.apk_filename || "app.apk",
      file_size: app.version_info?.file_size?.toString() || "0",
      hash_code: app.version_info?.hash_code || generateMockHash(app.app_id),
      hash_type: "md5",
      url: `${gitUrl}/${app.folder_name}/apk.apk`
    },
    pay_info: {
      discount: 100.0,
      order_source: "APPSTORE",
      original_price: 0.0,
      pay_ways: [],
      price: 0.0,
      is_purchase: false
    },
    statics: {
      downloads: "0",
      installs: "0",
      uninstalls: "0",
      updates: "0"
    },
    tags: app.featured ? [{ tag_code: "yes", type_code: "tuijian" }] : []
  };
}

// Форматирование приложения для детального просмотра
function formatAppForDetails(app) {
  const baseUrl = IS_DEV ? `http://${HOST}:${PORT}` : serverConfig.server.base_url;
  const gitUrl = `https://github.com/sumatoshi/dhu-apk-list-2/raw/main`;
  
  return {
    app_id: app.app_id,
    name: app.name,
    package_name: app.package_name,
    developer: app.developer || "Unknown Developer",
    icon: `${gitUrl}/${app.folder_name}/png.png`,
    introduction: app.description || "Описание отсутствует",
    notes: app.version_info?.release_notes || "Примечания к версии отсутствуют",
    update_at: app.updated_at ? new Date(app.updated_at).toISOString().slice(0, 10).replace(/-/g, '.') : "2025.07.03",
    version: app.version_info?.version || "1.0.0",
    version_id: app.version_info?.version_number?.toString() || "100000",
    version_number: app.version_info?.version_number || 100000,
    tid: app.app_id,
    uninstall: app.uninstall !== undefined ? app.uninstall : true,
    images: {
      horizontal: getAppScreenshots(app.folder_name, 'horizontal'),
      vertical: getAppScreenshots(app.folder_name, 'vertical')
    },
    apk_info: {
      apk_name: app.version_info?.apk_filename || "app.apk",
      file_size: app.version_info?.file_size?.toString() || "0",
      hash_code: app.version_info?.hash_code || generateMockHash(app.app_id),
      hash_type: "md5",
      url: `${gitUrl}/${app.folder_name}/apk.apk`
    },
    pay_info: {
      discount: 100.0,
      is_purchase: false,
      order_source: "APPSTORE",
      original_price: 0.0,
      pay_ways: [],
      price: 0.0
    },
    statics: {
      downloads: "2",
      installs: "2",
      uninstalls: "0",
      updates: "0"
    }
  };
}

// Получение скриншотов приложения
function getAppScreenshots(appFolder, orientation) {
  const screenshotsPath = path.join('./apps/store', appFolder, 'screenshots');
  const baseUrl = IS_DEV ? `http://${HOST}:${PORT}` : serverConfig.server.base_url;
  
  if (!fs.existsSync(screenshotsPath)) {
    return [];
  }
  
  try {
    const files = fs.readdirSync(screenshotsPath)
      .filter(file => /\.(png|jpg|jpeg)$/i.test(file))
      .map(file => `${baseUrl}/static/screenshots/${appFolder}/${file}`);
    
    return files.slice(0, 5); // Максимум 5 скриншотов
  } catch (error) {
    console.error(`Error reading screenshots for ${appFolder}:`, error.message);
    return [];
  }
}

// Генерация mock MD5 хеша
function generateMockHash(appId) {
  return crypto.createHash('md5').update(appId + Date.now()).digest('hex');
}

// =============================================================================
// ОБРАБОТКА ОШИБОК И ЗАПУСК СЕРВЕРА
// =============================================================================

// Handle 404 для неопределенных маршрутов
app.use('*', (req, res) => {
  console.log(`🔴 404 - Route not found: ${req.method} ${req.originalUrl}`);
  console.log(`🌐 Host: ${req.headers.host}`);
  console.log(`🤖 User-Agent: ${req.headers['user-agent']}`);
  console.log(`🔗 Referer: ${req.headers.referer}`);
  console.log(`⚠️  POTENTIAL MISSING ENDPOINT - Car might be trying to reach a different URL!`);
  
  res.status(404).json({
    code: 40404,
    data: null,
    msg: "Endpoint not found",
    success: false
  });
});

// Обработчик ошибок
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    code: 50000,
    data: null,
    msg: "Internal server error",
    success: false
  });
});

// Функция создания и запуска сервера
async function createServer() {
  try {
    // Сначала сканируем приложения
    console.log('🔍 Initializing app scanner...');
    await scanner.scanApps();
    
    // Обновляем глобальный кэш
    appsCache = scanner.appsCache;
    
    if (IS_DEV) {
      // Development mode - HTTP server
      const server = http.createServer(app);
      
      server.listen(PORT, HOST, () => {
        console.log(`\n🚀 Chang'An File Server running in DEVELOPMENT mode`);
        console.log(`🌐 Server URL: http://${HOST}:${PORT}`);
        console.log(`📱 Ready to handle Chang'An VCS API requests`);
        console.log(`🔓 Authentication is bypassed (dev mode)`);
        console.log(`📁 Static files served from /static`);
        console.log(`💾 Apps loaded: ${appsCache.size}`);
        console.log(`📋 Available endpoints:`);
        console.log(`   • GET  /hu-apigw/appstore/api/v1/app/list`);
        console.log(`   • GET  /hu-apigw/appstore/api/v1/app/details`);
        console.log(`   • GET  /hu-apigw/appstore/api/v1/app/query`);
        console.log(`   • GET  /hu-apigw/appstore/api/v1/task/initial-params`);
        console.log(`   • GET  /health (server status)`);
        console.log(`   • GET  /static/* (static files)\n`);
      });
      
    } else {
      // Production mode - HTTPS server
      const keyPath = path.join(__dirname, serverConfig.ssl.key_path);
      const certPath = path.join(__dirname, serverConfig.ssl.cert_path);
      
      if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        console.log('❌ SSL certificates not found. Please run: npm run generate-certs');
        process.exit(1);
      }

      const options = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      };

      const server = https.createServer(options, app);
      
      server.listen(PORT, HOST, () => {
        console.log(`\n🚀 Chang'An File Server running in PRODUCTION mode`);
        console.log(`🌐 Server URL: https://${HOST}:${PORT}`);
        console.log(`📱 Ready to handle Chang'An VCS API requests`);
        console.log(`🔐 Authentication is bypassed (mock mode)`);
        console.log(`📁 Static files served from /static`);
        console.log(`💾 Apps loaded: ${appsCache.size}`);
        console.log(`\n📋 Chang'An Compatible API endpoints:`);
        console.log(`   • GET  /hu-apigw/appstore/api/v1/app/list`);
        console.log(`   • GET  /hu-apigw/appstore/api/v1/app/details`);
        console.log(`   • GET  /hu-apigw/appstore/api/v1/app/query`);
        console.log(`   • GET  /hu-apigw/appstore/api/v1/task/initial-params`);
        console.log(`   • GET  /hu-apigw/appstore/api/v1/resource/update-time`);
        console.log(`   • GET  /hu-apigw/wiki/api/v1/commodity/purchase-list`);
        console.log(`   • POST /hu-apigw/evhu/api/push/getHuTags`);
        console.log(`   • POST /hu-apigw/huservice/api/v1/store/order-list`);
        console.log(`   • POST /appserver/api/hu/2.0/userBehavior`);
        console.log(`   • POST /dt/api/hu/2.0/userBehavior`);
        console.log(`   • GET  /health (server status)`);
        console.log(`   • GET  /static/* (static files)\n`);
        console.log(`🎯 For development mode, use: npm run dev-local\n`);
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`❌ Port ${PORT} is already in use`);
        } else if (err.code === 'EADDRNOTAVAIL') {
          console.error(`❌ Address ${HOST} is not available`);
        } else {
          console.error('❌ Server error:', err.message);
        }
        process.exit(1);
      });
    }
    
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Запускаем сервер
createServer();
