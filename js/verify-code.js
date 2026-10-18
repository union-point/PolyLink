import { config } from './config.js';
import { auth } from './services/index.js';
import { saveWorkflow } from './services/workflow.js';
import { start, bootstrap } from './shared/ui.js';
import { initializeCodeInputs } from './shared/code-inputs.js';
import { DataError } from './data/errors.js';

start(async () => {
  await bootstrap({ protectedPage: false });
  initializeCodeInputs('recovery', async (context, code) => {
    const result = await auth.verifyRecovery({ challengeId: context.challengeId, email: context.email, code });
    if(config.dataMode==='http'){saveWorkflow({...context,verified:true});location.href='reset-password.html';return;}
    if (!result?.recoveryToken) throw new DataError('CONTRACT', 'Verification response is missing recoveryToken.');
    saveWorkflow({ ...context, code, recoveryToken: result.recoveryToken });
    location.href = 'reset-password.html';
  });
});
