// Accounts for the login page. Run in WSL from the project folder:
//   node scripts/user.ts create <email>          create the account (asks for the password twice)
//   node scripts/user.ts reset-password <email>  new password; signs that account out everywhere
//   node scripts/user.ts disable|enable <email>  block or allow logging in (disable also signs out)
//   node scripts/user.ts reset-2fa <email>       turn two-factor off (lost phone and recovery codes); signs out everywhere
//   node scripts/user.ts list
// Passwords are typed at a hidden prompt, never passed as arguments (they would stay in the shell history).
// DATA_DIR=<dir> writes somewhere other than data/.
import { createInterface } from 'node:readline'
import { MIN_PASSWORD_LENGTH } from '../server/auth/password.ts'
import { deleteUserSessions } from '../server/auth/sessions.ts'
import { createUser, findByEmail, listUsers, setDisabled, setPassword, updateUser } from '../server/auth/users.ts'

/** Reads a line without echoing it. */
function askHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Run this in a terminal: the password is typed at a hidden prompt.')
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    // Echo nothing while the answer is typed; the question itself is written before muting.
    const output = rl as unknown as { _writeToOutput: (s: string) => void }
    process.stdout.write(question)
    output._writeToOutput = () => {}
    rl.question('', (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

async function askNewPassword(): Promise<string> {
  const password = await askHidden(`New password (at least ${MIN_PASSWORD_LENGTH} characters): `)
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Too short: at least ${MIN_PASSWORD_LENGTH} characters.`)
  if ((await askHidden('Repeat it: ')) !== password) throw new Error('The two passwords differ.')
  return password
}

async function existing(email: string | undefined) {
  if (!email) throw new Error('Give the account email.')
  const user = await findByEmail(email)
  if (!user) throw new Error(`No account for ${email}.`)
  return user
}

const [command, email] = process.argv.slice(2)
try {
  switch (command) {
    case 'create': {
      if (!email || !email.includes('@')) throw new Error('Usage: node scripts/user.ts create <email>')
      if (await findByEmail(email)) throw new Error(`An account for ${email} already exists (reset-password changes its password).`)
      const user = await createUser(email, await askNewPassword())
      console.log(`Created ${user.email}. Log in at /login.`)
      break
    }
    case 'reset-password': {
      const user = await existing(email)
      await setPassword(user.id, await askNewPassword())
      await deleteUserSessions(user.id)
      console.log(`Password changed for ${user.email}; its sessions were ended.`)
      break
    }
    case 'disable':
    case 'enable': {
      const user = await existing(email)
      await setDisabled(user.id, command === 'disable')
      if (command === 'disable') await deleteUserSessions(user.id)
      console.log(`${user.email} ${command}d.`)
      break
    }
    case 'reset-2fa': {
      const user = await existing(email)
      await updateUser(user.id, ({ totpSecret: _s, totpPending: _p, totpLastStep: _l, recoveryHashes: _r, ...u }) => u)
      await deleteUserSessions(user.id)
      console.log(`Two-factor is off for ${user.email}; its sessions were ended. Turn it on again under Account.`)
      break
    }
    case 'list': {
      const users = await listUsers()
      if (!users.length) console.log('No accounts yet: node scripts/user.ts create <email>')
      for (const u of users) console.log(`${u.email}  ${u.role}${u.totpSecret ? '  2FA' : ''}${u.disabled ? '  (disabled)' : ''}  since ${u.createdAt.slice(0, 10)}`)
      break
    }
    default:
      console.log('Usage: node scripts/user.ts create|reset-password|reset-2fa|disable|enable <email>  |  node scripts/user.ts list')
      process.exitCode = 1
  }
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
}
