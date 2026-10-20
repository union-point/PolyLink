// Only a block owned by the caller can be removed from this flow.
export async function openDirectWithUnblock(chat, userId, confirm) {
  try { return await chat.openDirect(userId); }
  catch (error) {
    if (error.code !== 'DIRECT_BLOCKED_BY_YOU') throw error;
    if (!await confirm('Դուք արգելափակել եք այս օգտատիրոջը։ Ապաարգելափակե՞լ նրան և կապ հաստատել։')) return null;
    await chat.block(userId, false);
    return chat.openDirect(userId);
  }
}
