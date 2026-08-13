function e(e){let t=[],n=[],r=``,i=!1,a=()=>{n.push(r.trim()),r=``},o=()=>{a(),t.push(n),n=[]},s=String(e||``).replace(/^﻿/,``).replace(/\r\n/g,`
`).replace(/\r/g,`
`);for(let e=0;e<s.length;e++){let t=s[e];i?t===`"`?s[e+1]===`"`?(r+=`"`,e++):i=!1:r+=t:t===`"`?i=!0:t===`,`?a():t===`
`?o():r+=t}return o(),t}function t(e){let t=[],n=``,r=!1,i=[];for(let a=0;a<e.length;a++){let o=e[a],s=e[a+1];o===`"`?r&&s===`"`?(n+=`"`,a++):r=!r:o===`,`&&!r?(i.push(n.trim()),n=``):(o===`\r`||o===`
`)&&!r?(o===`\r`&&s===`
`&&a++,i.push(n.trim()),i.some(e=>e.length>0)&&t.push(i),i=[],n=``):n+=o}return(n||i.length>0)&&(i.push(n.trim()),i.some(e=>e.length>0)&&t.push(i)),t}function n(e){if(!e)return 0;let t=String(e).replace(/\s+/g,``).replace(`,`,`.`),n=parseFloat(t);return Number.isNaN(n)?0:n}export{e as n,n as r,t};