import { copyPrompt } from '../core'

export const commands = [
  'copy changes',
  'copy prompt',
  'changes',
]

export const description = 'copy your edits as a prompt for a coding agent'

export default async function() {
  const { copied, count } = await copyPrompt()

  console.info(copied
    ? `VisBug: copied changes for ${count} element${count === 1 ? '' : 's'}`
    : 'VisBug: nothing has been edited yet')
}
