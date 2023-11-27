import { TestSession } from '@salesforce/cli-plugins-testkit';

describe('check license', () => {
  let session: TestSession;

  before(async () => {
    session = await TestSession.create({ devhubAuthStrategy: 'NONE' });
  });

  after(async () => {
    await session?.clean();
  });

  it('should work', () => {});
});
