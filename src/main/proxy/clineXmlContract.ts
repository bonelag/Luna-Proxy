import {getClientProtocolProfile} from './clientContracts';

export function getXmlPassthroughContract(messages: any[] = []): string {
  return getClientProtocolProfile(messages).passthroughText;
}

export function injectContractIntoPrompt(messages: any[]): any[] {
  const contract = getXmlPassthroughContract(messages);
  const hasContract = messages.some(m =>
    m.role === 'system' && m.content && m.content.includes('reverse proxy')
  );
  if (hasContract) return messages;
  const result = [...messages];
  const sysIdx = result.findIndex(m => m.role === 'system');
  if (sysIdx >= 0) {
    result[sysIdx] = { ...result[sysIdx], content: `${result[sysIdx].content}\n\n${contract}` };
  } else {
    result.unshift({ role: 'system', content: contract });
  }
  return result;
}
