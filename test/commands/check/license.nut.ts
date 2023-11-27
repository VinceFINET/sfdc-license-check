import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';

describe('check license', () => {
  let session: TestSession;

  before(async () => {
    session = await TestSession.create({ devhubAuthStrategy: 'NONE' });
  });

  after(async () => {
    await session?.clean();
  });

  it('should work', () => {
    const command = 'check license';
    const output = execCmd(command, { ensureExitCode: 0 }).shellOutput.stdout;
    expect(output).to.contain('');
  });
});
