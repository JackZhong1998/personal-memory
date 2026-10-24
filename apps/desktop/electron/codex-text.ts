// Codex's user role also carries app context and approval-agent bootstraps.
export function codexUserText(raw:string):string{
 let text=raw.trim();
 if(/^(?:# AGENTS\.md instructions|The following is the Codex agent history (?:whose request action you are|added since your last approval assessment))/.test(text))return '';
 if(/^<(?:environment_context|permissions|user_instructions|recommended_plugins|skills_instructions|app-context|heartbeat|external_codex_apps_open_page|external_codex_apps_writing_block_edits|system-reminder)(?:\s|>)/.test(text))return '';
 if(text.startsWith('<send_user_message_question_reply>')){
  try{const body=text.replace(/^<send_user_message_question_reply>\s*/,'').replace(/\s*<\/send_user_message_question_reply>$/,'');const replies=JSON.parse(body);return Array.isArray(replies)?replies.map(r=>typeof r.answer==='string'?r.answer:'').filter(Boolean).join('\n'):''}catch{return ''}
 }
 if(/^# Files (?:mentioned|pasted) by the user:/.test(text)){
  const marker='## My request:';const at=text.indexOf(marker);if(at<0)return '';
  text=text.slice(at+marker.length).replace(/<image\b[^>]*>[\s\S]*?<\/image>/g,'').trim();
 }
 return text;
}
