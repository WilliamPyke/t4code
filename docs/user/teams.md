# Teams

A team is a group of people signed in to [T Connect](./remote-access.md) who see the threads its
members share with it. Teammates come back to a thread any day without a new link, and each one
joins as their account, with its name and picture, instead of a name they type.

## Create a team and invite people

Sign in to T Connect. The sidebar then shows **Teams**; choose **+** next to it and name the team.
You can be in up to 20 teams, and a team holds up to 50 people.

On the team's page, choose **Invite people** and send the link, such as
`https://app.example.org/t/tulip-otter-harbor`. Anyone who opens it while signed in to T Connect
can choose **Join team**; someone signed out is asked to sign in first. An invite works for 7
days, and choosing **Invite people** again shows the same one until it is close to expiring.
Anyone who has the link can join, so send it only to the people you want.

The team's owner can rename it, remove a member, or delete the team. Members can leave. Removing
or leaving takes the threads that person shared off the team.

## Share a thread with a team

This needs **Settings → Labs → Guest links** on the machine that runs the thread, and that machine
linked to T Connect with an account in the team.

1. Choose **Share with guests** on the thread.
2. Choose **Share with a team** and pick the team.

The thread is listed on the team's page for 90 days, under its current title. Members choose
**Open** there to join it, and see it as [a guest does](./guest-links.md#what-a-guest-sees). A
member's place in a thread lasts a day; opening it after that joins it again for them. Each
person's messages still wait for your **Send**, and
[send without asking](./guest-links.md#let-a-guest-send-without-asking) follows the same API key
rule. The thread header names the team; on web, click it to see who joined, with their pictures.

Sharing with a team replaces a guest link the thread had, and choosing **Make a guest link**
replaces the team share; T Code asks first if anyone has joined. **Stop sharing**, archiving the
thread, or unlinking the machine from T Connect ends it for everyone and takes it off the team's
page. Turning off **Guest links** on that machine hides its threads from the team until you turn
them on again.

## The team board

Choose **Board** at the top of the team's page. It has a card for each shared thread, with
**Open thread**, and one for each member. Add notes, tasks and links, and draw arrows, as on
[a thread's board](./guest-links.md#see-the-room-as-a-board); a task can be given to any member.
The board is kept on T Connect, so it is there even while every member's machine is off, and
changes from others appear within a few seconds. It has no pointers or comments on replies, and
nothing on it reaches an agent: to use a note, copy it into a message yourself.

## Remove someone

Removing a member in the thread's guest list keeps that account out of the thread, and everyone
else stays in. Removing someone from the team, or their leaving it, takes them out of the team's
threads within about a minute of their next action there; while the thread's machine cannot reach
T Connect, they stay until it can. If they are added back to the team, they can open the threads
again. Notes they left on the team board keep their name.

Teams work in the hosted T Code app without a machine of your own: sign in, and your teams and
their threads are in the sidebar.
