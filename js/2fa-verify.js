import { auth } from './services/index.js';
import { clearWorkflow } from './services/workflow.js';
import { start, bootstrap } from './shared/ui.js';
import { initializeCodeInputs } from './shared/code-inputs.js';
import { finishLogin } from './shared/auth-ui.js';

start(async () => {
  await bootstrap({ protectedPage: false });
  initializeCodeInputs('second-factor', async (context, code) => {
    const result = await auth.verifySecondFactor({ challengeId: context.challengeId, code });
    clearWorkflow();
    finishLogin(result.user ? result : { user: result });
  });
});
