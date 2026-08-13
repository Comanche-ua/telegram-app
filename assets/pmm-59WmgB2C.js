import{a as e,n as t,o as n,r,s as i}from"./react-_SDClmCM.js";import{i as a,n as o}from"./index-CHKU3FAQ.js";import{r as s,t as c}from"./csv-B91FevQD.js";function l(e){let t=c(e),n=`Сьогодні`,r=[],i=null,a={dt:0,petrol:0,foam:0};for(let e=0;e<t.length;e++){let o=t[e];if(!o||o.length<4)continue;for(let e=0;e<o.length;e++)o[e].includes(`Станом на`)&&(n=o[e+1]||n);if(o.some(e=>e.includes(`ВСЬОГО ПО ЗАГОНУ НА СКЛАДІ`))){let e=(o[6]||``).toLowerCase(),t=s(o[8]);(e.includes(`дт`)||e.includes(`дп`))&&(a.dt=t),e.includes(`бензин`)&&(a.petrol=t),e.includes(`піноутворювач`)&&(a.foam=t);continue}let c=o[1]?o[1].replace(/\n/g,` `).replace(/\s+/g,` `).trim():``,l=o[3]?o[3].replace(/\n/g,` `).replace(/\s+/g,` `).trim():``,u=o[6]?o[6].replace(/\n/g,` `).replace(/\s+/g,` `).trim():``,d=o[7]?o[7].replace(/\n/g,` `).replace(/\s+/g,` `).trim():``,f=s(o[8]),p=s(o[9]),m=s(o[10]),h=(o[11]||``).trim().toLowerCase();if(c&&c!==`Підрозділ`&&(i={name:c,vehicles:[],generators:[],stock:{dt:0,petrol:0,foam:0}},r.push(i)),!(!i||!l)){if(l===`Склад`||l.toLowerCase().includes(`склад`)){let n=u.toLowerCase();n.includes(`дп`)||n.includes(`дт`)?i.stock.dt=f:n.includes(`бензин`)?i.stock.petrol=f:n.includes(`піноутворювач`)&&(i.stock.foam=f);let r=e+1;for(;r<t.length&&(!t[r][1]||t[r][1].trim()===``)&&(!t[r][3]||t[r][3].trim()===``);){let e=(t[r][6]||``).toLowerCase(),n=s(t[r][8]);e.includes(`дп`)||e.includes(`дт`)?i.stock.dt=n:e.includes(`бензин`)?i.stock.petrol=n:e.includes(`піноутворювач`)&&(i.stock.foam=n),r++}e=r-1;continue}if(l.toLowerCase().includes(`генератор`)||l.toLowerCase().includes(`агрегат`)||l.toLowerCase().includes(`мотопомпа`)){i.generators.push({name:l+(u?` (${u})`:``),inTank:f,consumption:p,fuelType:h||(l.toLowerCase().includes(`дизель`)?`дп`:`бензин`)});continue}i.vehicles.push({mark:l,model:u,plate:d,inTank:f,consumption:p,capacity:m,fuelType:h||`дп`})}}!a.dt&&!a.petrol&&!a.foam&&r.forEach(e=>{a.dt+=e.stock.dt,a.petrol+=e.stock.petrol,a.foam+=e.stock.foam});let o=0,l=0,u=0;return r.forEach(e=>{e.vehicles.forEach(e=>{o++,l+=e.inTank,e.capacity>0&&e.inTank/e.capacity<.3&&u++})}),{asOfDate:n,units:r,overallStock:a,kpi:{totalVehicles:o,totalTankFuel:l,lowFuelCount:u}}}var u=e=>document.getElementById(e),d=``,f=`all`;function p(e){d=e}function m(e){f=e}function h(){let e=r(t.PMM_CUSTOM_URL);return e&&e.trim()?e.trim():null}function g(){let e=h();if(!e)return[];if(e.includes(`script.google.com/macros`))return[e];let t=e.match(/\/d\/([a-zA-Z0-9-_]+)/);if(!t)return[e];let n=t[1],r=e.match(/[?&]gid=([0-9]+)/)||e.match(/#gid=([0-9]+)/),i=r?r[1]:`0`;return[`https://docs.google.com/spreadsheets/d/${n}/export?format=csv&gid=${i}`,`https://docs.google.com/spreadsheets/d/${n}/gviz/tq?tqx=out:csv&gid=${i}`,`https://docs.google.com/spreadsheets/d/${n}/export?format=csv`]}async function _(e){try{let t=await fetch(e,{cache:`no-store`,credentials:`include`,redirect:`follow`});if(console.log(`PMM fetch [creds] ${e.slice(0,60)} => status:${t.status}`),t.ok){let e=await t.text();if(console.log(`PMM response preview: ${e.slice(0,120).replace(/\n/g,`|`)}`),e&&!e.trimStart().startsWith(`<`)&&e.includes(`,`))return e;console.warn(`PMM: response looks like HTML, not CSV`)}}catch(e){console.warn(`PMM fetch [creds] error:`,e.message)}try{let t=await fetch(e,{cache:`no-store`,redirect:`follow`});if(console.log(`PMM fetch [no-creds] ${e.slice(0,60)} => status:${t.status}`),t.ok){let e=await t.text();if(console.log(`PMM response preview: ${e.slice(0,120).replace(/\n/g,`|`)}`),e&&!e.trimStart().startsWith(`<`)&&e.includes(`,`))return e;console.warn(`PMM: response looks like HTML, not CSV`)}}catch(e){console.warn(`PMM fetch [no-creds] error:`,e.message)}return null}async function v(){let e=g();if(e.length===0)return console.info(`PMM: no URL configured, skipping fetch`),null;let n=null;for(let t of e){if(n=await _(t),n){console.log(`PMM: loaded CSV from`,t.slice(0,70));break}console.warn(`PMM: no valid CSV from`,t.slice(0,70))}if(n){let e=l(n);return e.lastFetchedAt=new Date().toISOString(),i(t.PMM_CACHE,e),e}console.warn(`PMM: all candidates failed, loading from cache`);let a=r(t.PMM_CACHE);if(a)try{return JSON.parse(a)}catch{}return null}function y(){try{let e=localStorage.getItem(t.PMM_CACHE);return e?JSON.parse(e):null}catch{return null}}function b(){let e=document.createElement(`div`);e.id=`pmm-csv-overlay`,e.style.cssText=`
    position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);
    display:flex;align-items:center;justify-content:center;padding:16px;
  `,e.innerHTML=`
    <div style="
      background:#1e2030;border-radius:16px;padding:20px;
      width:100%;max-width:520px;max-height:90vh;overflow-y:auto;
      border:1px solid rgba(255,255,255,.12);
    ">
      <h3 style="margin:0 0 8px;font-size:16px;color:#e2e8f0">📋 Вставити CSV вручну</h3>
      <p style="font-size:12px;color:#94a3b8;margin:0 0 12px">
        Відкрийте Google Таблицю → Файл → Завантажити → CSV (.csv),<br>
        потім вставте вміст файлу нижче:
      </p>
      <textarea id="pmm-csv-textarea" rows="10" style="
        width:100%;box-sizing:border-box;
        background:#0d1117;color:#e2e8f0;
        border:1px solid rgba(255,255,255,.15);border-radius:8px;
        padding:10px;font-size:11px;font-family:monospace;resize:vertical;
      " placeholder="Вставте CSV тут…"></textarea>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button id="pmm-csv-apply" style="
          flex:1;background:linear-gradient(135deg,#4f8ef7,#7c5ce8);
          color:#fff;border:none;border-radius:8px;padding:10px;
          font-size:14px;cursor:pointer;
        ">✅ Завантажити</button>
        <button id="pmm-csv-cancel" style="
          flex:1;background:rgba(255,255,255,.08);
          color:#e2e8f0;border:none;border-radius:8px;padding:10px;
          font-size:14px;cursor:pointer;
        ">Скасувати</button>
      </div>
    </div>
  `,document.body.appendChild(e),document.getElementById(`pmm-csv-cancel`)?.addEventListener(`click`,()=>e.remove()),document.getElementById(`pmm-csv-apply`)?.addEventListener(`click`,()=>{let n=document.getElementById(`pmm-csv-textarea`)?.value?.trim();if(n)try{let r=l(n);r.lastFetchedAt=new Date().toISOString(),r._manual=!0,i(t.PMM_CACHE,r),e.remove(),S()}catch(e){alert(`Помилка розбору CSV: `+e.message)}})}var x=e=>`function doGet() {
  var ss = SpreadsheetApp.openById('${e}');
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var csv = data.map(function(row) {
    return row.map(function(cell) {
      var s = String(cell == null ? '' : cell);
      if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\\n') >= 0)
        return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(',');
  }).join('\\n');
  return ContentService.createTextOutput(csv)
    .setMimeType(ContentService.MimeType.TEXT);
}`;async function S(){let n=document.getElementById(`pmm-workspace`);if(!n)return;let r=y();if(r||(h()&&(n.innerHTML=`
        <div class="pmm-loading-box">
          <div class="pmm-spinner"></div>
          <p>Завантажуємо інформацію з Google Таблиці ПММ…</p>
        </div>
      `),r=await v()),!r||!r.units||r.units.length===0){let i=h(),a=i&&i.includes(`script.google.com/macros`);if(!i){n.innerHTML=`
        <div class="pmm-empty-box" style="text-align:center;max-width:380px;margin:0 auto">
          <span style="font-size:48px">⛽</span>
          <h2 style="margin:12px 0 8px;font-size:18px">Розділ ПММ</h2>
          <p style="font-size:13px;color:#94a3b8;margin:0 0 20px;line-height:1.6">
            Щоб завантажувати дані пального,<br>вкажіть URL таблиці у налаштуваннях.
          </p>
          <button type="button" class="pmm-btn-primary" id="pmm-open-settings-btn"
            style="width:100%;max-width:260px">
            ⚙️ Відкрити налаштування
          </button>
        </div>
      `,document.getElementById(`pmm-open-settings-btn`)?.addEventListener(`click`,()=>{document.getElementById(`settings-btn`)?.click()});return}n.innerHTML=`
      <div class="pmm-empty-box" style="text-align:left;max-width:480px;margin:0 auto">
        <div style="text-align:center;margin-bottom:16px">
          <span style="font-size:36px">⛽</span>
          <h2 style="margin:8px 0 4px;font-size:17px">Не вдалося завантажити ПММ</h2>
          <p style="font-size:13px;opacity:.7;margin:0">${r?`CSV завантажено, але розпізнано 0 підрозділів.`:a?`Apps Script URL не відповідає або повертає помилку.`:`Google Таблиця заблокована для прямого доступу (CORS/авторизація).`}</p>
        </div>

        <div style="background:rgba(79,142,247,.08);border:1px solid rgba(79,142,247,.25);border-radius:12px;padding:14px;margin-bottom:12px">
          <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#4f8ef7">⚡ Рішення: Google Apps Script (1 хв)</p>
          <ol style="margin:0;padding-left:18px;font-size:12px;line-height:1.8;color:#cbd5e0">
            <li>Відкрий <b>script.google.com</b> → «Новий проєкт»</li>
            <li>Встав код (кнопка нижче → скопіювати)</li>
            <li>«Розгорнути» → «Нове розгортання» → Тип: <b>Вебзастосунок</b></li>
            <li>Доступ: <b>Усі (анонімні)</b> → Розгорнути</li>
            <li>Скопіюй URL виду <code style="font-size:10px">script.google.com/macros/s/…/exec</code></li>
            <li>Встав його в <b>Налаштування → URL таблиці ПММ</b></li>
          </ol>
          <button id="pmm-copy-script-btn" type="button" style="
            margin-top:12px;width:100%;
            background:rgba(79,142,247,.2);border:1px solid rgba(79,142,247,.4);
            color:#4f8ef7;border-radius:8px;padding:9px;font-size:13px;cursor:pointer;
          ">📋 Скопіювати код скрипту</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px">
          <button type="button" class="pmm-btn-primary" id="pmm-retry-btn">🔄 Спробувати знову</button>
          <button type="button" class="pmm-btn-secondary" id="pmm-manual-csv-btn">📄 Вставити CSV вручну</button>
        </div>
      </div>
    `;let o=h()||``,s=x((()=>{let e=o.match(/\/d\/([a-zA-Z0-9-_]+)/);return e?e[1]:`PASTE_YOUR_SPREADSHEET_ID_HERE`})());document.getElementById(`pmm-copy-script-btn`)?.addEventListener(`click`,()=>{navigator.clipboard.writeText(s).then(()=>{let e=document.getElementById(`pmm-copy-script-btn`);e&&(e.textContent=`✅ Скопійовано!`,setTimeout(()=>{e.textContent=`📋 Скопіювати код скрипту`},2e3))}).catch(()=>{prompt(`Скопіюй код вручну:`,s)})}),document.getElementById(`pmm-retry-btn`)?.addEventListener(`click`,()=>{e(t.PMM_CACHE),S()}),document.getElementById(`pmm-manual-csv-btn`)?.addEventListener(`click`,()=>{b()});return}let i=d.toLowerCase().trim(),s=r.units.map(e=>{let t=e.name.toLowerCase().includes(i),n=e.vehicles.filter(e=>f===`low`&&!(e.capacity>0&&e.inTank/e.capacity<.3)?!1:!i||t||e.mark.toLowerCase().includes(i)||e.model.toLowerCase().includes(i)||e.plate.toLowerCase().includes(i)||e.fuelType&&e.fuelType.toLowerCase().includes(i));return{...e,matchingVehicles:n,hasMatch:t||n.length>0||i.includes(`склад`)&&(e.stock.dt||e.stock.petrol||e.stock.foam)}}).filter(e=>e.hasMatch),c=e=>`${Math.round(e).toLocaleString(`uk-UA`)} л`;n.innerHTML=`
    <div class="pmm-shell">
      <!-- Top Control Bar -->
      <header class="pmm-header">
        <div class="pmm-title-block">
          <span class="pmm-eyebrow">Моніторинг пального та резервів</span>
          <h1 class="pmm-main-title">⛽ Запас та витрата ПММ</h1>
          <p class="pmm-subtitle">
            Дані з Google Таблиці · Станом на <strong>${o(r.asOfDate)}</strong>
            ${r.lastFetchedAt?`· Оновлено ${new Date(r.lastFetchedAt).toLocaleTimeString(`uk-UA`,{hour:`2-digit`,minute:`2-digit`})}`:``}
          </p>
        </div>
        <div class="pmm-header-actions">
          <button type="button" class="pmm-btn-refresh" id="pmm-sync-btn" title="Оновити з Google Таблиці">
            <span class="pmm-refresh-icon">🔄</span> Оновити дані
          </button>
        </div>
      </header>

      <!-- KPI Dashboard Grid -->
      <div class="pmm-kpi-grid">
        <div class="pmm-kpi-card blue">
          <div class="pmm-kpi-icon">🛢️</div>
          <div class="pmm-kpi-content">
            <div class="pmm-kpi-label">Склад ДТ</div>
            <div class="pmm-kpi-value">${c(r.overallStock.dt)}</div>
            <div class="pmm-kpi-sub">Загальний резерв ДП</div>
          </div>
        </div>

        <div class="pmm-kpi-card amber">
          <div class="pmm-kpi-icon">⛽</div>
          <div class="pmm-kpi-content">
            <div class="pmm-kpi-label">Склад Бензин</div>
            <div class="pmm-kpi-value">${c(r.overallStock.petrol)}</div>
            <div class="pmm-kpi-sub">Загальний резерв А-92/95</div>
          </div>
        </div>

        <div class="pmm-kpi-card green">
          <div class="pmm-kpi-icon">🧯</div>
          <div class="pmm-kpi-content">
            <div class="pmm-kpi-label">Піноутворювач</div>
            <div class="pmm-kpi-value">${c(r.overallStock.foam)}</div>
            <div class="pmm-kpi-sub">На складах підрозділів</div>
          </div>
        </div>

        <div class="pmm-kpi-card purple">
          <div class="pmm-kpi-icon">🚒</div>
          <div class="pmm-kpi-content">
            <div class="pmm-kpi-label">Спецтехніка</div>
            <div class="pmm-kpi-value">${r.kpi.totalVehicles} <small>од.</small></div>
            <div class="pmm-kpi-sub">Запас в баках: ${c(r.kpi.totalTankFuel)}</div>
          </div>
        </div>
      </div>

      <!-- Filters and Search Controls -->
      <div class="pmm-toolbar">
        <div class="pmm-search-wrap">
          <span class="pmm-search-icon">🔍</span>
          <input type="text" class="pmm-search-input" id="pmm-search-input" value="${o(d)}" placeholder="Пошук підрозділу, авто (марка, держномер)...">
          ${d?`<button type="button" class="pmm-search-clear" id="pmm-search-clear">✕</button>`:``}
        </div>
        <div class="pmm-filter-group">
          <button type="button" class="pmm-filter-btn ${f===`all`?`active`:``}" data-pmm-filter="all">Всі підрозділи</button>
          <button type="button" class="pmm-filter-btn ${f===`low`?`active`:``}" data-pmm-filter="low">
            ⚠️ Низький запас ${r.kpi.lowFuelCount>0?`<span class="pmm-badge-alert">${r.kpi.lowFuelCount}</span>`:``}
          </button>
        </div>
      </div>

      <!-- Units Grid -->
      <div class="pmm-units-grid">
        ${s.length?s.map(e=>{let t=f===`low`?e.matchingVehicles:e.vehicles;return`
            <div class="pmm-unit-card">
              <div class="pmm-unit-header">
                <div>
                  <span class="pmm-unit-tag">Підрозділ</span>
                  <h3 class="pmm-unit-title">${o(e.name)}</h3>
                </div>
                <div class="pmm-unit-stock-pills">
                  <span class="pmm-pill dt" title="Запас ДТ на складі">🛢️ ДТ: ${e.stock.dt} л</span>
                  <span class="pmm-pill petrol" title="Запас Бензину на складі">⛽ Б: ${e.stock.petrol} л</span>
                  ${e.stock.foam?`<span class="pmm-pill foam" title="Запас піноутворювача">🧯 П: ${e.stock.foam} л</span>`:``}
                </div>
              </div>

              <!-- Vehicles Table / Cards -->
              <div class="pmm-vehicles-list">
                ${t.length?t.map(e=>{let t=e.capacity>0?Math.min(100,Math.round(e.inTank/e.capacity*100)):e.inTank>0?100:0,n=`good`;return t<30?n=`low`:t<60&&(n=`warn`),`
                    <div class="pmm-vehicle-row ${n===`low`?`is-low`:``}">
                      <div class="pmm-vehicle-info">
                        <div class="pmm-vehicle-name">${o(e.mark)}</div>
                        <div class="pmm-vehicle-sub">
                          ${e.model?`<span class="pmm-v-tag">${o(e.model)}</span>`:``}
                          ${e.plate?`<span class="pmm-v-plate">${o(e.plate)}</span>`:``}
                          <span class="pmm-v-fueltype">${e.fuelType?e.fuelType.toUpperCase():``}</span>
                        </div>
                      </div>

                      <div class="pmm-vehicle-tank">
                        <div class="pmm-tank-header">
                          <span class="pmm-tank-text">
                            <strong>${e.inTank} л</strong> ${e.capacity?`/ ${e.capacity} л`:``}
                            ${e.consumption?`<small class="pmm-consumption">(витрата ${e.consumption}л)</small>`:``}
                          </span>
                          <span class="pmm-tank-pct ${n}">${e.capacity?`${t}%`:``}</span>
                        </div>
                        ${e.capacity?`
                          <div class="pmm-tank-bar-track">
                            <div class="pmm-tank-bar-fill ${n}" style="width: ${t}%"></div>
                          </div>
                        `:``}
                      </div>
                    </div>
                  `}).join(``):`<div class="pmm-no-vehicles">Немає авто за обраними критеріями.</div>`}
              </div>

              ${e.generators&&e.generators.length?`
                <div class="pmm-generators-section">
                  <div class="pmm-gen-title">⚡ Генератори та агрегати:</div>
                  <div class="pmm-gen-tags">
                    ${e.generators.map(e=>`
                      <span class="pmm-gen-tag">
                        ${o(e.name)}: <strong>${e.inTank} л</strong> (${e.fuelType})
                      </span>
                    `).join(``)}
                  </div>
                </div>
              `:``}
            </div>
          `}).join(``):`<div class="pmm-empty-search">За вашим запитом нічого не знайдено.</div>`}
      </div>
    </div>
  `;let l=n.querySelector(`#pmm-sync-btn`);l&&l.addEventListener(`click`,async()=>{l.disabled=!0,l.innerHTML=`<span class="pmm-refresh-icon spinning">🔄</span> Оновлюємо…`,await v(),S()});let u=n.querySelector(`#pmm-search-input`);u&&u.addEventListener(`input`,e=>{d=e.target.value,S();let t=n.querySelector(`#pmm-search-input`);t&&(t.focus(),t.setSelectionRange(d.length,d.length))});let p=n.querySelector(`#pmm-search-clear`);p&&p.addEventListener(`click`,()=>{d=``,S()}),n.querySelectorAll(`[data-pmm-filter]`).forEach(e=>{e.addEventListener(`click`,()=>{f=e.dataset.pmmFilter,S()})}),r&&r.lastFetchedAt&&Date.now()-new Date(r.lastFetchedAt).getTime()>3e5&&v().then(e=>{e&&a.getState().appMode===`pmm`&&S()})}function C(){let i=u(`pmm-sheets-url`),o=u(`pmm-sheets-save-btn`),s=u(`pmm-sheets-reset-btn`),c=u(`pmm-sheets-status`);if(i){let e=r(t.PMM_CUSTOM_URL);e&&(i.value=e)}o&&!o.dataset.bound&&(o.dataset.bound=`1`,o.addEventListener(`click`,async()=>{let r=i?i.value.trim():``;r?(n(t.PMM_CUSTOM_URL,r),c&&(c.textContent=`Збережено!`)):(e(t.PMM_CUSTOM_URL),c&&(c.textContent=`Використовується стандартне посилання`)),v().then(e=>{e&&a.getState().appMode===`pmm`&&S()}),setTimeout(()=>{c&&(c.textContent=``)},3e3)})),s&&!s.dataset.bound&&(s.dataset.bound=`1`,s.addEventListener(`click`,()=>{e(t.PMM_CUSTOM_URL),e(t.PMM_CACHE),i&&(i.value=``),c&&(c.textContent=`Скинуто`),setTimeout(()=>{c&&(c.textContent=``)},3e3)}))}export{C as bindPmmSettings,v as fetchPmmData,g as getCandidateCsvUrls,h as getPmmCustomUrl,y as loadPmmDataFromCache,f as pmmActiveFilter,d as pmmSearchQuery,S as renderPmmWorkspace,m as setPmmActiveFilter,p as setPmmSearchQuery,b as showPmmManualCsvInput};