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

The thread is listed on the team's page for 90 days. Members choose **Open** there to join it,
and see it as [a guest does](./guest-links.md#what-a-guest-sees). Each person's messages still
wait for your **Send**, and
[send without asking](./guest-links.md#let-a-guest-send-without-asking) follows the same API key
rule. The thread header names the team; on web, click it to see who joined, with their pictures.

Sharing with a team replaces a guest link the thread had, and choosing **Make a guest link**
replaces the team share; T Code asks first if anyone has joined. **Stop sharing**, archiving the
thread, or unlinking the machine from T Connect ends it for everyone, and stopping or archiving
also takes it off the team's page.

## Remove someone

Removing a member in the thread's guest list keeps that account out of the thread, and everyone
else stays in. Removing someone from the team stops them opening the team's threads: a member who
already joined keeps their place for up to a day, until their app has to ask the team again. To
end their access at once, remove them in the thread as well.

Teams work in the hosted T Code app without a machine of your own: sign in, and your teams and
their threads are in the sidebar.
