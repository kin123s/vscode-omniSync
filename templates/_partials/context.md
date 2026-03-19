{{#issue}}
### [{{issue.id}}] {{issue.title}}

- **상태**: {{issue.status}}
- **URL**: {{issue.url}}

{{issue.description}}
{{/issue}}
{{^issue}}
_연결된 이슈 정보가 없습니다._
{{/issue}}
