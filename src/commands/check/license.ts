/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectory(dirname(fileURLToPath(import.meta.url)));
const messages = Messages.loadMessages('sfdc-license-check', 'check.license');

export type LicenseCheckData =
  | {
      id: string;
      name: string;
      used: number;
      total: number;
      unnecessaryAssigned: number;
      unnecessaryAssignedToActiveUsers: number;
      unnecessaryAssignments: string[];
    }
  | undefined;

export default class LicenseCheck extends SfCommand<LicenseCheckData[]> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg({
      summary: messages.getMessage('flags.target-org.summary'),
      char: 'o',
    }),
    'api-version': Flags.string({
      summary: messages.getMessage('flags.api-version.summary'),
      char: 'v',
      default: '43.0',
    }),
  };

  public async run(): Promise<LicenseCheckData[]> {
    const { flags } = await this.parse(LicenseCheck);

    const org = flags['target-org'];
    const conn = org.getConnection(flags['api-version']);

    this.log('Step #1. List the PermissionSets that are linked to a License...');
    const permissionSetResult = await conn.query(
      'SELECT Id, Name, LicenseId ' +
        'FROM PermissionSet ' +
        'WHERE IsOwnedByProfile = false ' +
        'AND LicenseId <> NULL'
    );
    if (permissionSetResult.totalSize === 0) {
      this.log('> No Permission Set record, strange!');
      return [];
    }
    this.log(`> We found: ${permissionSetResult.totalSize} records.`);
    this.log();

    this.log('Step #2. Filter the PermissionSets list with only LicenseId starting with "0PL"...');
    const permissionSetsFiltered = permissionSetResult.records.filter(
      (r) => typeof r.LicenseId === 'string' && r.LicenseId.startsWith('0PL')
    );
    if (permissionSetsFiltered.length === 0) {
      this.log('> No Permission Set record left after filtering, strange!');
      return [];
    }
    this.log(`> We filtered: ${permissionSetsFiltered.length} records.`);
    this.log();

    this.log('Step #3: Get the distinct LicenseIds from the previous list');
    const licenseIds = new Set<string>();
    permissionSetsFiltered.forEach((r) => {
      if (typeof r.LicenseId === 'string') {
        licenseIds.add(r.LicenseId);
      }
    });
    if (licenseIds.size === 0) {
      this.log('> No License Id, strange!');
      return [];
    }
    this.log(`> We got: ${licenseIds.size} license ids.`);
    this.log();

    this.log('Step #4: Get the permission set assignments for all licenses');
    let idsAsString = '';
    licenseIds.forEach((r) => {
      idsAsString += `'${r}',`;
    });
    idsAsString = idsAsString.substring(0, idsAsString.length - 1);
    const psAssignmentResult = await conn.query(
      'SELECT PermissionSet.LicenseId, AssigneeId ' +
        'FROM PermissionSetAssignment ' +
        'WHERE PermissionSet.LicenseId IN (' +
        idsAsString +
        ') ' +
        'ORDER BY PermissionSet.LicenseId, AssigneeId'
    );
    this.log(`> We found: ${psAssignmentResult.totalSize} permission set assignments.`);
    this.log();

    this.log('Step #5: Get the permission set license assignments for all licenses');
    const pslAssignmentResult = await conn.query(
      'SELECT Id, AssigneeId, Assignee.IsActive, PermissionSetLicenseId, ' +
        'PermissionSetLicense.DeveloperName, PermissionSetLicense.MasterLabel, ' +
        'PermissionSetLicense.UsedLicenses, PermissionSetLicense.TotalLicenses ' +
        'FROM PermissionSetLicenseAssign ' +
        'WHERE PermissionSetLicenseId IN (' +
        idsAsString +
        ') ' +
        'ORDER BY PermissionSetLicenseId, AssigneeId'
    );
    this.log(`> We found: ${pslAssignmentResult.totalSize} permission set license assignments.`);
    this.log();

    this.log('Step #6: Get the ps license assignments (#5) without corresponding ps assignments (#4)');
    const pslAssignments = new Map<string, any>();
    pslAssignmentResult.records.forEach((r) =>
      pslAssignments.set(`${r['PermissionSetLicenseId']}_${r['AssigneeId']}`, r)
    );
    psAssignmentResult.records.forEach((r) =>
      pslAssignments.delete(`${r['PermissionSet.LicenseId']}_${r['AssigneeId']}`)
    );
    this.log(`> We found: ${pslAssignments.size} permission set license assignments that could be removed.`);
    this.log();

    this.log('Step #7: Returning the ps license assignments to kill...');
    const psls: Map<string, LicenseCheckData> = new Map<string, LicenseCheckData>();
    const output: LicenseCheckData[] = [];
    pslAssignments.forEach((r) => {
      if (psls.has(r.PermissionSetLicenseId) === false) {
        psls.set(r.PermissionSetLicenseId, {
          id: r.PermissionSetLicenseId,
          name: r.PermissionSetLicense.MasterLabel,
          used: r.PermissionSetLicense.UsedLicenses,
          total: r.PermissionSetLicense.TotalLicenses,
          unnecessaryAssigned: 0,
          unnecessaryAssignedToActiveUsers: 0,
          unnecessaryAssignments: [],
        });
      }
      const psl: LicenseCheckData = psls.get(r.PermissionSetLicenseId);
      if (psl) {
        psl.unnecessaryAssigned++;
        if (r.Assignee.IsActive) {
          psl.unnecessaryAssignedToActiveUsers++;
          psl.unnecessaryAssignments.push(r.Id);
        }
      }
    });
    psls.forEach((r) => {
      output.push(r);
    });
    return output;
  }
}
