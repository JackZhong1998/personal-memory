export const presets=[
 {host:'claude.ai',name:'Claude',selector:'[data-testid="user-message"], [data-message-author-role="user"], .font-user-message'},
 {host:'grok.com',name:'Grok',selector:'[data-message-author-role="user"], [data-role="user"], .user-message'},
 {host:'manus.im',name:'Manus',selector:'[data-message-author-role="user"], [data-role="user"], .user-message'},
 {host:'manus.ai',name:'Manus',selector:'[data-message-author-role="user"], [data-role="user"], .user-message'},
 {host:'genspark.ai',name:'Genspark',selector:'[data-message-author-role="user"], [data-role="user"], .user-message'},
 {host:'chatgpt.com',name:'ChatGPT',selector:'[data-message-author-role="user"]'},
 {host:'doubao.com',name:'豆包',selector:'[data-testid="send_message"], [data-message-author-role="user"], [data-role="user"]'},
 {host:'deepseek.com',name:'DeepSeek',selector:'[data-message-author-role="user"], [data-role="user"], [data-testid="user-message"]'},
 {host:'kimi.com',name:'Kimi',selector:'.chat-item-user, [data-message-author-role="user"], [data-role="user"]'},
 {host:'kimi.moonshot.cn',name:'Kimi',selector:'.chat-item-user, [data-message-author-role="user"], [data-role="user"]'},
 {host:'tongyi.aliyun.com',name:'通义',selector:'[data-message-author-role="user"], [data-role="user"], [data-testid="user-message"]'},
 {host:'qianwen.com',name:'通义',selector:'[data-message-author-role="user"], [data-role="user"], [data-testid="user-message"]'},
 {host:'qwen.ai',name:'Qwen',selector:'[data-message-author-role="user"], [data-role="user"], .user-message'},
 {host:'yuanbao.tencent.com',name:'腾讯元宝',selector:'.agent-chat__list__item--human, [data-message-author-role="user"], [data-role="user"]'}
];
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function preset(url){const u=new URL(url);return presets.find(p=>u.hostname===p.host||u.hostname.endsWith('.'+p.host))??{name:u.hostname,selector:''}}
export function cleanURL(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')throw new Error('仅支持标准 HTTPS 页面');u.search='';u.hash='';return u.href}
export function validateRule(rule){
 if(!rule||typeof rule.selector!=='string'||!rule.selector.trim()||rule.selector.length>1000)throw new Error('请填写用户消息 CSS 选择器');
 // A rule must identify individual submitted messages, never the whole page or editor.
 if(/(^|[,\s>+~])(body|html|\*|textarea|input)(?=$|[\s,.#[:>+~])/i.test(rule.selector)||/contenteditable/i.test(rule.selector))throw new Error('不能选择整页或输入框');
 if(rule.bodySelector&&rule.bodySelector.length>1000)throw new Error('正文选择器过长');
 if(rule.idAttribute&&!/^(data-[\w-]+|id)$/.test(rule.idAttribute))throw new Error('消息 ID 属性仅支持 id / data-*');
 if(rule.conversationParam&&!/^[\w-]{1,80}$/.test(rule.conversationParam))throw new Error('会话参数无效');
 return rule;
}
export async function extract(doc,url,rule){
 validateRule(rule);const u=new URL(url),safe=cleanURL(url);
 const param=rule.conversationParam?u.searchParams.get(rule.conversationParam):'';
 if((u.pathname==='/'||/^\/(new|chat|app)\/?$/.test(u.pathname))&&!param)throw new Error('请先打开一段有独立网址的对话');
 if(rule.conversationParam&&!param)throw new Error('当前页面缺少指定的会话参数');
 const roots=[...doc.querySelectorAll(rule.selector)];if(roots.length>2000)throw new Error('当前页面匹配超过 2,000 个节点，请缩小规则范围');const all=new Set(roots),messages=[],counts=new Map();
 for(const root of roots){
  // Nested matched nodes count only once. Skip assistant nodes and all editable regions.
  if([...all].some(parent=>parent!==root&&parent.contains(root)))continue;
  if(root.matches('html,body,input,textarea,[contenteditable]')||root.closest('[contenteditable],textarea,input,[data-message-author-role="assistant"],[data-role="assistant"]')||root.querySelector('[contenteditable],textarea,input,[data-message-author-role="assistant"],[data-role="assistant"]'))continue;
  const body=rule.bodySelector?root.querySelector(rule.bodySelector):root;if(!body)continue;
  const text=(body.innerText??body.textContent??'').trim();if(!text)continue;if(text.length>64000)throw new Error('单条提问超过 64,000 字符，请缩小规则范围');
  const fingerprint=await digest(text);const ordinal=counts.get(fingerprint)??0;counts.set(fingerprint,ordinal+1);
  const nativeId=rule.idAttribute?root.getAttribute(rule.idAttribute):null;
  messages.push({sequence:messages.length,id:nativeId?'native:'+await digest(nativeId):'text:'+fingerprint+':'+ordinal,role:'user',text});
 }
 return {format:'tracelet.browser.capture.v1',url:safe,conversationId:await digest(safe+(param?'?conversation='+param:'')),title:(doc.title||u.hostname).slice(0,200),capturedAt:new Date().toISOString(),messages};
}
export function packets(records){
 const groups=new Map();for(const record of Object.values(records)){const key=record.url+record.conversationId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(record)}
 const result=[];
 for(const rows of groups.values()){
  let batch=[],bytes=0;
  const push=()=>{if(!batch.length)return;const first=batch[0];result.push({format:'tracelet.browser.capture.v1',url:first.url,conversationId:first.conversationId,title:first.title,capturedAt:first.capturedAt,messages:batch.map(({id,text,capturedAt,sequence})=>({id,sequence,role:'user',text,capturedAt}))});batch=[];bytes=0};
  for(const row of rows){const size=new TextEncoder().encode(JSON.stringify(row)).length;if(batch.length===50||bytes+size>700000)push();batch.push(row);bytes+=size}push();
 }
 return result;
}
