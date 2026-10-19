import {extract} from './core.mjs';
if(!globalThis.__traceletCapture){globalThis.__traceletCapture=true;
 let timer,busy=false,last='',path=location.href;
 async function scan(){if(busy)return;busy=true;try{const rule=await chrome.runtime.sendMessage({type:'config'});if(!rule?.enabled)return;
  const packet=await extract(document,location.href,rule);if(!packet.messages.length)throw new Error('未匹配到用户消息，请在会话加载后预览规则');
  const key=JSON.stringify([packet.url,packet.conversationId,packet.messages]);if(last===key)return;
  const response=await chrome.runtime.sendMessage({type:'capture',packet});if(response?.ok)last=key;
 }catch(e){try{await chrome.runtime.sendMessage({type:'capture-error',error:String(e.message).slice(0,200)})}catch{}}finally{busy=false}}
 const schedule=()=>{clearTimeout(timer);timer=setTimeout(scan,900)};
 new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
 setInterval(()=>{if(path!==location.href){path=location.href;last='';schedule()}},1200);
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.type==='preview'){extract(document,location.href,message.rule).then(reply).catch(e=>reply({error:e.message}));return true}if(message.type==='rescan'){last='';schedule()}});
 schedule();
}
