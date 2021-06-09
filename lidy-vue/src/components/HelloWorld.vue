<template>
  <div class="hello">
    <textarea v-model="content"></textarea>
    {{ JSON.stringify(result) }}
  </div>
</template>

<script>
/* eslint-disable */
import { parse } from "../../../lidy-js/index.js"

export default {
  name: 'HelloWorld',
  data() {
    return {content: ""}
  },
  props: {
    msg: String
  },
  computed: {
    result() { return parse(this.content) }
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
h3 {
  margin: 40px 0 0;
}
ul {
  list-style-type: none;
  padding: 0;
}
li {
  display: inline-block;
  margin: 0 10px;
}
a {
  color: #42b983;
}
</style>
